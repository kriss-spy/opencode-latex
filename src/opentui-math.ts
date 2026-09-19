import {
  ImageRenderable,
  type ColorInput,
  type ImageRenderProtocol,
  type OptimizedBuffer,
  type RGBA,
  type RenderContext,
} from "@opentui/core"
import { MeasureMode } from "@opentui/core/yoga"
import { LatexRenderable, type LatexRenderableOptions } from "opentui-math"
import { renderLatexToPng, type RenderedMathImage } from "opentui-math/graphics"

export type GraphicsMode = "auto" | "kitty" | "cells"

export interface GraphicalLatexRenderableOptions extends LatexRenderableOptions {
  graphicsMode?: GraphicsMode
  fontSize?: number
  pixelRatio?: number
  maxRasterWidth?: number
  maxRasterHeight?: number
  maxRasterPixels?: number
  graphicsForegroundColor?: string
}

const DEFAULT_CELL_WIDTH = 8
const DEFAULT_CELL_HEIGHT = 16

interface RuntimeImageLibrary {
  imageDecode(data: Uint8Array): { status: number; handle: unknown | null }
  imageCopyPixels(
    handle: unknown,
    destination: Uint8Array,
    stride: number,
    bgra: boolean,
  ): number
  imageCreateFromRgba(
    pixels: Uint8Array,
    width: number,
    height: number,
    stride: number,
  ): { status: number; handle: unknown | null }
  imageDestroy(handle: unknown): void
}

interface RuntimeNativeImage {
  readonly lib: RuntimeImageLibrary
  readonly ptr: unknown
  readonly width: number
  readonly height: number
}

/**
 * A narrow fork of opentui-math's graphical renderable. MathJax still creates
 * the PNG, while OpenTUI's image buffer owns Kitty/SIXEL transport and cleanup.
 */
export class GraphicalLatexRenderable extends LatexRenderable {
  private readonly graphicsContext: RenderContext
  private readonly graphicsMode: GraphicsMode
  private readonly fontSize: number
  private readonly pixelRatio: number
  private readonly graphicsParseOptions: Pick<
    GraphicalLatexRenderableOptions,
    "macros" | "maxExpand" | "maxSourceLength" | "maxExpandedLength" | "maxDepth"
  >
  private readonly rasterLimitOptions: Pick<
    GraphicalLatexRenderableOptions,
    "maxRasterWidth" | "maxRasterHeight" | "maxRasterPixels"
  >
  private readonly graphicsImage: ImageRenderable
  private graphicsColorFollowsForeground: boolean
  private graphicsColor: string
  private image: RenderedMathImage | undefined
  private runtimeImage: RuntimeNativeImage | undefined
  private sixelRuntimeImage: RuntimeNativeImage | undefined
  private sixelBackdropKey: string | undefined
  private imageColumns = 0
  private imageRows = 0
  private rasterRevision = 0
  private rasterizing = false
  private renderFailure: Error | undefined
  private pendingRaster: Promise<void> = Promise.resolve()

  constructor(ctx: RenderContext, options: GraphicalLatexRenderableOptions = {}) {
    super(ctx, options)
    this.graphicsContext = ctx
    this.graphicsMode = options.graphicsMode ?? "auto"
    this.fontSize = positiveNumber(options.fontSize, 20)
    this.pixelRatio = positiveNumber(options.pixelRatio, 2)
    this.graphicsParseOptions = {
      ...(options.macros ? { macros: options.macros } : {}),
      ...(options.maxExpand !== undefined ? { maxExpand: options.maxExpand } : {}),
      ...(options.maxSourceLength !== undefined ? { maxSourceLength: options.maxSourceLength } : {}),
      ...(options.maxExpandedLength !== undefined
        ? { maxExpandedLength: options.maxExpandedLength }
        : {}),
      ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
    }
    this.rasterLimitOptions = {
      ...(options.maxRasterWidth !== undefined ? { maxRasterWidth: options.maxRasterWidth } : {}),
      ...(options.maxRasterHeight !== undefined ? { maxRasterHeight: options.maxRasterHeight } : {}),
      ...(options.maxRasterPixels !== undefined ? { maxRasterPixels: options.maxRasterPixels } : {}),
    }
    this.graphicsColorFollowsForeground = options.graphicsForegroundColor === undefined
    this.graphicsColor = options.graphicsForegroundColor ?? colorToCss(super.foregroundColor)
    this.graphicsImage = new ImageRenderable(ctx, {
      fit: "fit",
      protocol: this.requestedImageProtocol(),
    })
    this.setupGraphicsMeasureFunction()
    this.graphicsContext.on("capabilities", this.handleCapabilities)
    this.graphicsContext.on("frame", this.handleFrame)
    this.graphicsContext.on("resize", this.handleResize)
    this.scheduleRaster()
  }

  public override get content(): string {
    return super.content
  }

  public override set content(value: string) {
    if (value === super.content) return
    super.content = value
    this.scheduleRaster()
  }

  public override get foregroundColor(): RGBA {
    return super.foregroundColor
  }

  public override set foregroundColor(value: ColorInput) {
    super.foregroundColor = value
    if (this.graphicsColorFollowsForeground) {
      this.graphicsColor = colorToCss(super.foregroundColor)
      this.scheduleRaster()
    }
  }

  public get graphicsForegroundColor(): string {
    return this.graphicsColor
  }

  public set graphicsForegroundColor(value: string | undefined) {
    const followsForeground = value === undefined
    const nextColor = value ?? colorToCss(super.foregroundColor)
    if (
      followsForeground === this.graphicsColorFollowsForeground &&
      nextColor === this.graphicsColor
    ) return

    this.graphicsColorFollowsForeground = followsForeground
    this.graphicsColor = nextColor
    this.scheduleRaster()
  }

  public override get displayMode(): boolean {
    return super.displayMode
  }

  public override set displayMode(value: boolean) {
    if (value === super.displayMode) return
    super.displayMode = value
    this.scheduleRaster()
  }

  public get isUsingGraphics(): boolean {
    return this.canUseGraphics() && Boolean(this.image) && !this.renderFailure
  }

  public get graphicsError(): Error | undefined {
    return this.renderFailure
  }

  public get effectiveGraphicsProtocol(): Exclude<ImageRenderProtocol, "auto"> {
    return this.graphicsImage.effectiveProtocol
  }

  public async whenGraphicsReady(): Promise<boolean> {
    while (!this.isDestroyed) {
      const pending = this.pendingRaster
      await pending
      if (pending === this.pendingRaster) return this.isUsingGraphics
    }
    return false
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.isUsingGraphics) {
      super.renderSelf(buffer)
      return
    }

    const background = super.backgroundColor
    const originX = this.buffered ? 0 : this.screenX
    const originY = this.buffered ? 0 : this.screenY
    if (background.a > 0 && this.width > 0 && this.height > 0) {
      buffer.fillRect(originX, originY, this.width, this.height, background)
    }
    this.renderGraphics(buffer)
  }

  private renderGraphics(buffer: OptimizedBuffer): void {
    if (!this.isUsingGraphics || !this.image || this.width <= 0 || this.height <= 0) return
    const terminalWidth = this.graphicsContext.terminalWidth ?? 0
    const terminalHeight = this.graphicsContext.terminalHeight ?? 0
    const resolution = terminalWidth > 0 && terminalHeight > 0
      ? this.graphicsContext.resolution
      : null
    const cellWidth = resolution?.width
      ? resolution.width / terminalWidth
      : DEFAULT_CELL_WIDTH
    const cellHeight = resolution?.height
      ? resolution.height / terminalHeight
      : DEFAULT_CELL_HEIGHT
    const terminalScale = Math.min(
      cellWidth / DEFAULT_CELL_WIDTH,
      cellHeight / DEFAULT_CELL_HEIGHT,
    )
    const naturalPixelWidth = this.image.width / this.pixelRatio * terminalScale
    const naturalPixelHeight = this.image.height / this.pixelRatio * terminalScale
    const scale = Math.min(
      1,
      this.width * cellWidth / naturalPixelWidth,
      this.height * cellHeight / naturalPixelHeight,
    )
    const pixelWidth = Math.max(1, Math.round(naturalPixelWidth * scale))
    const pixelHeight = Math.max(1, Math.round(naturalPixelHeight * scale))
    const columns = Math.max(1, Math.min(this.width, Math.ceil(pixelWidth / cellWidth)))
    const rows = Math.max(1, Math.min(this.height, Math.ceil(pixelHeight / cellHeight)))
    const originX = this.buffered ? 0 : this.screenX
    const originY = this.buffered ? 0 : this.screenY
    const x = originX + Math.floor((this.width - columns) / 2)
    const y = originY + Math.floor((this.height - rows) / 2)
    const protocol = this.requestedImageProtocol()
    const nativeImage = this.effectiveGraphicsProtocol === "sixel"
      ? this.ensureSixelRuntimeImage(buffer, x, y, columns, rows)
      : this.ensureRuntimeImage(buffer)
    if (!nativeImage) return

    buffer.drawImage(
      nativeImage as never,
      x,
      y,
      columns,
      rows,
      pixelWidth,
      pixelHeight,
      0,
      0,
      nativeImage.width,
      nativeImage.height,
      protocol,
    )
  }

  protected override destroySelf(): void {
    this.graphicsContext.off("capabilities", this.handleCapabilities)
    this.graphicsContext.off("frame", this.handleFrame)
    this.graphicsContext.off("resize", this.handleResize)
    this.disposeRuntimeImage()
    if (!this.graphicsImage.isDestroyed) this.graphicsImage.destroy()
    super.destroySelf()
  }

  private readonly handleCapabilities = (): void => {
    this.graphicsImage.protocol = this.requestedImageProtocol()
    this.scheduleRaster()
    this.updateImageCellSize()
    this.yogaNode.markDirty()
    this.requestRender()
  }

  private readonly handleFrame = (): void => {
    if (
      this.canUseGraphics() &&
      !this.image &&
      !this.renderFailure &&
      !this.rasterizing
    ) this.scheduleRaster()
  }

  private readonly handleResize = (): void => {
    if (this.canUseGraphics()) {
      if (!this.image && !this.renderFailure && !this.rasterizing) this.scheduleRaster()
    } else if (this.image || this.rasterizing) this.scheduleRaster()
    this.updateImageCellSize()
    this.yogaNode.markDirty()
    this.requestRender()
  }

  private scheduleRaster(): void {
    const revision = ++this.rasterRevision
    this.renderFailure = undefined
    if (!this.canUseGraphics()) {
      this.clearGraphics()
      this.rasterizing = false
      this.pendingRaster = Promise.resolve()
      return
    }

    this.rasterizing = true
    this.pendingRaster = renderLatexToPng(this.content, {
      displayMode: this.displayMode,
      foregroundColor: this.graphicsColor,
      fontSize: this.fontSize,
      pixelRatio: this.pixelRatio,
      ...this.graphicsParseOptions,
      ...this.rasterLimitOptions,
    })
      .then((image) => {
        if (revision !== this.rasterRevision || this.isDestroyed) return
        this.disposeRuntimeImage()
        this.image = image
        this.updateImageCellSize()
        this.graphicsImage.protocol = this.requestedImageProtocol()
        this.yogaNode.markDirty()
        this.requestRender()
      })
      .catch((error) => {
        if (revision !== this.rasterRevision || this.isDestroyed) return
        this.renderFailure = error instanceof Error ? error : new Error(String(error))
        this.clearGraphics()
        this.yogaNode.markDirty()
        this.requestRender()
      })
      .finally(() => {
        if (revision === this.rasterRevision) this.rasterizing = false
      })
  }

  private updateImageCellSize(): void {
    if (!this.image) return
    this.imageColumns = Math.max(
      1,
      Math.ceil(this.image.width / (DEFAULT_CELL_WIDTH * this.pixelRatio)),
    )
    this.imageRows = Math.max(
      1,
      Math.ceil(this.image.height / (DEFAULT_CELL_HEIGHT * this.pixelRatio)),
    )
  }

  private canUseGraphics(): boolean {
    if (this.graphicsMode === "cells") return false
    if (this.graphicsMode === "kitty") return true
    return this.graphicsImage.effectiveProtocol !== "blocks"
  }

  private requestedImageProtocol(): ImageRenderProtocol {
    return this.graphicsMode === "kitty" ? "kitty" : "auto"
  }

  private clearGraphics(): void {
    this.disposeRuntimeImage()
    this.image = undefined
  }

  private setupGraphicsMeasureFunction(): void {
    this.yogaNode.setMeasureFunc((width, widthMode, height, heightMode) => {
      const intrinsicWidth = this.isUsingGraphics ? this.imageColumns : this.intrinsicWidth
      const intrinsicHeight = this.isUsingGraphics ? this.imageRows : this.intrinsicHeight
      return {
        width: constrainedSize(intrinsicWidth, width, widthMode),
        height: constrainedSize(intrinsicHeight, height, heightMode),
      }
    })
  }

  private ensureRuntimeImage(buffer: OptimizedBuffer): RuntimeNativeImage | undefined {
    if (!this.image) return undefined
    // TUI plugins can resolve a separate @opentui/core module. Decode through
    // the target buffer's native library so its image handle is valid there.
    const lib = (buffer as unknown as { lib: RuntimeImageLibrary }).lib
    if (this.runtimeImage?.lib === lib) return this.runtimeImage
    this.disposeRuntimeImage()

    const decoded = lib.imageDecode(this.image.png)
    if (decoded.status !== 0 || !decoded.handle) {
      this.renderFailure = new Error(`OpenTUI image decode failed with status ${decoded.status}`)
      this.requestRender()
      return undefined
    }
    this.runtimeImage = {
      lib,
      ptr: decoded.handle,
      width: this.image.width,
      height: this.image.height,
    }
    return this.runtimeImage
  }

  private ensureSixelRuntimeImage(
    buffer: OptimizedBuffer,
    x: number,
    y: number,
    columns: number,
    rows: number,
  ): RuntimeNativeImage | undefined {
    const source = this.ensureRuntimeImage(buffer)
    if (!source) return undefined

    const backgrounds = readCellBackgrounds(buffer, x, y, columns, rows)
    if (!backgrounds.some((_, index) => index % 4 === 3 && backgrounds[index]! > 0)) {
      this.disposeSixelRuntimeImage()
      return source
    }

    const backdropKey = `${x}:${y}:${columns}:${rows}:${hashBytes(backgrounds)}`
    if (this.sixelRuntimeImage?.lib === source.lib && this.sixelBackdropKey === backdropKey) {
      return this.sixelRuntimeImage
    }

    this.disposeSixelRuntimeImage()
    const pixels = new Uint8Array(source.width * source.height * 4)
    const copyStatus = source.lib.imageCopyPixels(source.ptr, pixels, source.width * 4, false)
    if (copyStatus !== 0) return source

    compositeCellBackgrounds(pixels, source.width, source.height, backgrounds, columns, rows)
    const created = source.lib.imageCreateFromRgba(pixels, source.width, source.height, source.width * 4)
    if (created.status !== 0 || !created.handle) return source

    this.sixelRuntimeImage = {
      lib: source.lib,
      ptr: created.handle,
      width: source.width,
      height: source.height,
    }
    this.sixelBackdropKey = backdropKey
    return this.sixelRuntimeImage
  }

  private disposeRuntimeImage(): void {
    this.disposeSixelRuntimeImage()
    if (!this.runtimeImage) return
    this.runtimeImage.lib.imageDestroy(this.runtimeImage.ptr)
    this.runtimeImage = undefined
  }

  private disposeSixelRuntimeImage(): void {
    if (this.sixelRuntimeImage) {
      this.sixelRuntimeImage.lib.imageDestroy(this.sixelRuntimeImage.ptr)
      this.sixelRuntimeImage = undefined
    }
    this.sixelBackdropKey = undefined
  }
}

function readCellBackgrounds(
  buffer: OptimizedBuffer,
  x: number,
  y: number,
  columns: number,
  rows: number,
): Uint8Array {
  const result = new Uint8Array(columns * rows * 4)
  const source = buffer.buffers.bg
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const sourceX = x + column
      const sourceY = y + row
      if (sourceX < 0 || sourceY < 0 || sourceX >= buffer.width || sourceY >= buffer.height) continue
      const sourceOffset = (sourceY * buffer.width + sourceX) * 4
      const targetOffset = (row * columns + column) * 4
      result[targetOffset] = source[sourceOffset]! & 0xff
      result[targetOffset + 1] = source[sourceOffset + 1]! & 0xff
      result[targetOffset + 2] = source[sourceOffset + 2]! & 0xff
      result[targetOffset + 3] = source[sourceOffset + 3]! & 0xff
    }
  }
  return result
}

function compositeCellBackgrounds(
  pixels: Uint8Array,
  width: number,
  height: number,
  backgrounds: Uint8Array,
  columns: number,
  rows: number,
): void {
  for (let py = 0; py < height; py++) {
    const cellY = Math.min(rows - 1, Math.floor(py * rows / height))
    for (let px = 0; px < width; px++) {
      const cellX = Math.min(columns - 1, Math.floor(px * columns / width))
      const pixelOffset = (py * width + px) * 4
      const backgroundOffset = (cellY * columns + cellX) * 4
      const sourceAlpha = pixels[pixelOffset + 3]!
      const backgroundAlpha = backgrounds[backgroundOffset + 3]!
      if (backgroundAlpha === 0) continue

      const inverseSourceAlpha = 255 - sourceAlpha
      const outputAlphaScaled = sourceAlpha * 255 + backgroundAlpha * inverseSourceAlpha
      for (let channel = 0; channel < 3; channel++) {
        const source = pixels[pixelOffset + channel]!
        const background = backgrounds[backgroundOffset + channel]!
        pixels[pixelOffset + channel] = Math.round(
          (source * sourceAlpha * 255 + background * backgroundAlpha * inverseSourceAlpha) /
          outputAlphaScaled,
        )
      }
      pixels[pixelOffset + 3] = Math.round(outputAlphaScaled / 255)
    }
  }
}

function hashBytes(bytes: Uint8Array): number {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function constrainedSize(intrinsic: number, available: number, mode: MeasureMode): number {
  if (mode === MeasureMode.Exactly) return Math.max(0, Math.floor(available))
  if (mode === MeasureMode.AtMost) {
    return Math.max(0, Math.min(intrinsic, Math.floor(available)))
  }
  return intrinsic
}

function colorToCss(color: RGBA): string {
  const [r, g, b, a] = color.toInts()
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback
}

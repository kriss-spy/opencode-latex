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
    const nativeImage = this.ensureRuntimeImage(buffer)
    if (!nativeImage) return
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
    const naturalPixelWidth = this.image.width / this.pixelRatio
    const naturalPixelHeight = this.image.height / this.pixelRatio
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
      this.requestedImageProtocol(),
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
    this.imageColumns = Math.max(
      1,
      Math.ceil(this.image.width / (cellWidth * this.pixelRatio)),
    )
    this.imageRows = Math.max(
      1,
      Math.ceil(this.image.height / (cellHeight * this.pixelRatio)),
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

  private disposeRuntimeImage(): void {
    if (!this.runtimeImage) return
    this.runtimeImage.lib.imageDestroy(this.runtimeImage.ptr)
    this.runtimeImage = undefined
  }
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

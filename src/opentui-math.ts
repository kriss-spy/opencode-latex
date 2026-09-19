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
  private imageColumns = 0
  private imageRows = 0
  private rasterRevision = 0
  private renderFailure: Error | undefined
  private pendingRaster: Promise<void> = Promise.resolve()

  constructor(ctx: RenderContext, options: GraphicalLatexRenderableOptions = {}) {
    super(ctx, options)
    this.graphicsContext = ctx
    this.graphicsMode = options.graphicsMode ?? "auto"
    this.fontSize = positiveNumber(options.fontSize, 20)
    this.pixelRatio = positiveNumber(options.pixelRatio, 1)
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
    return this.canUseGraphics() && Boolean(this.image && this.graphicsImage.image) &&
      !this.latexError && !this.renderFailure
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

    const nativeImage = this.graphicsImage.image
    if (!nativeImage || this.width <= 0 || this.height <= 0) return
    const fitted = this.graphicsImage.getFittedSize(this.width, this.height)
    if (fitted.width <= 0 || fitted.height <= 0) return

    const x = originX + Math.floor((this.width - fitted.width) / 2)
    const y = originY + Math.floor((this.height - fitted.height) / 2)
    const terminalWidth = this.graphicsContext.terminalWidth ?? 0
    const terminalHeight = this.graphicsContext.terminalHeight ?? 0
    const resolution = terminalWidth > 0 && terminalHeight > 0
      ? this.graphicsContext.resolution
      : null
    const pixelWidth = resolution
      ? Math.max(1, Math.round(fitted.width * resolution.width / terminalWidth))
      : 0
    const pixelHeight = resolution
      ? Math.max(1, Math.round(fitted.height * resolution.height / terminalHeight))
      : 0

    buffer.drawImage(
      nativeImage,
      x,
      y,
      fitted.width,
      fitted.height,
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
    if (!this.graphicsImage.isDestroyed) this.graphicsImage.destroy()
    super.destroySelf()
  }

  private readonly handleCapabilities = (): void => {
    this.graphicsImage.protocol = this.requestedImageProtocol()
    this.scheduleRaster()
    this.yogaNode.markDirty()
    this.requestRender()
  }

  private scheduleRaster(): void {
    const revision = ++this.rasterRevision
    this.renderFailure = undefined
    if (!this.canUseGraphics() || this.latexError) {
      this.clearGraphics()
      this.pendingRaster = Promise.resolve()
      return
    }

    this.pendingRaster = renderLatexToPng(this.content, {
      displayMode: this.displayMode,
      foregroundColor: this.graphicsColor,
      fontSize: this.fontSize,
      pixelRatio: this.pixelRatio,
      ...this.graphicsParseOptions,
      ...this.rasterLimitOptions,
    })
      .then(async (image) => {
        if (revision !== this.rasterRevision || this.isDestroyed) return
        this.image = image
        this.updateImageCellSize()
        this.graphicsImage.protocol = this.requestedImageProtocol()
        this.graphicsImage.source = image.png
        await this.graphicsImage.loadPromise
        if (revision !== this.rasterRevision || this.isDestroyed) return
        if (this.graphicsImage.loadError) throw this.graphicsImage.loadError
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
    this.image = undefined
    this.graphicsImage.source = undefined
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

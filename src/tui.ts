import { Plugin } from "@opencode/plugin/tui"
import { GraphicalLatexRenderable } from "opentui-math/graphics"

const LANGUAGE = "latex"
const GRAPHICS_MODES = ["auto", "kitty", "cells"] as const
type GraphicsMode = typeof GRAPHICS_MODES[number]

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function graphicsMode(value: unknown): GraphicsMode {
  return typeof value === "string" && GRAPHICS_MODES.includes(value as GraphicsMode)
    ? value as GraphicsMode
    : "auto"
}

export function normalizeLatexSource(source: string): string {
  const commandSlashRuns = source.match(/\\+(?=[A-Za-z]+)/g) ?? []
  const hasDoubleEscapedCommand = commandSlashRuns.some((run) => run.length > 1)
  const hasCorrectlyEscapedCommand = commandSlashRuns.some((run) => run.length === 1)

  return hasDoubleEscapedCommand && !hasCorrectlyEscapedCommand
    ? source.replaceAll("\\\\", "\\")
    : source
}

export default Plugin.define({
  id: "opencode.latex.tui",
  setup(context) {
    const color = typeof context.options.color === "string"
      ? context.options.color
      : context.themeMode === "light" ? "#24292f" : "#d4d4d4"
    const fontSize = positiveNumber(context.options.fontSize, 32)
    const pixelRatio = positiveNumber(context.options.pixelRatio, 1)
    const mode = graphicsMode(context.options.graphicsMode)

    return context.markdown.registerCodeBlockRenderer(LANGUAGE, (token, render) => {
      try {
        return new GraphicalLatexRenderable(context.renderer, {
          content: normalizeLatexSource(token.text),
          displayMode: true,
          fallback: "source",
          foregroundColor: color,
          graphicsForegroundColor: color,
          graphicsMode: mode,
          fontSize,
          pixelRatio,
        })
      } catch {
        return render.defaultRender()
      }
    })
  },
})

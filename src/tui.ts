import { Plugin } from "@opencode/plugin/tui"
import { GraphicalLatexRenderable } from "./opentui-math.js"

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
  return source.replace(/\\+/g, (run, offset: number) => {
    if (run.length >= 4 && run.length % 2 === 0) return "\\".repeat(run.length / 2)
    const next = source[offset + run.length]
    const looksLikeEscapedCommand = next !== undefined && !/\s|&|\\|\[/.test(next)
    return run.length === 2 && looksLikeEscapedCommand ? "\\" : run
  })
}

export default Plugin.define({
  id: "opencode.latex.tui",
  setup(context) {
    const color = typeof context.options.color === "string"
      ? context.options.color
      : context.themeMode === "light" ? "#24292f" : "#d4d4d4"
    const fontSize = positiveNumber(context.options.fontSize, 20)
    const pixelRatio = positiveNumber(context.options.pixelRatio, 2)
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

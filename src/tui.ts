import { ImageRenderable } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import { renderLatex } from "./render.js"

const LANGUAGE = "latex"

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function isDuplicateRenderer(error: unknown, language: string): boolean {
  const message = typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error)
  return message.includes(`Markdown code-block renderer already registered: ${language}`)
}

export default Plugin.define({
  id: "opencode.latex.tui",
  setup(context) {
    const color = typeof context.options.color === "string"
      ? context.options.color
      : context.themeMode === "light" ? "#24292f" : "#d4d4d4"
    const scale = positiveNumber(context.options.scale, 2)
    const cellWidth = positiveNumber(context.options.cellWidth, 8)
    const cellHeight = positiveNumber(context.options.cellHeight, 16)

    try {
      return context.markdown.registerCodeBlockRenderer(LANGUAGE, (token, render) => {
        try {
          const image = renderLatex(token.text, { color, scale })
          return new ImageRenderable(context.renderer, {
            source: image.png,
            width: Math.max(1, Math.ceil(image.width / cellWidth)),
            height: Math.max(1, Math.ceil(image.height / cellHeight)),
            fit: "fit",
          })
        } catch {
          return render.defaultRender()
        }
      })
    } catch (error) {
      if (!isDuplicateRenderer(error, LANGUAGE)) throw error
    }
  },
})

import { ImageRenderable } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import { renderLatex } from "./render.js"

const LANGUAGES = ["latex", "math"] as const

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
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

    const unregisterRenderers = LANGUAGES.map((language) =>
      context.markdown.registerCodeBlockRenderer(language, (token, render) => {
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
      }),
    )

    return () => unregisterRenderers.forEach((dispose) => dispose())
  },
})

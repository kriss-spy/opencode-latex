import { Plugin } from "@opencode/plugin/tui"
import { GraphicalLatexRenderable } from "./opentui-math.js"

const LANGUAGE = "latex"
const GRAPHICS_MODES = ["auto", "kitty", "cells"] as const
type GraphicsMode = typeof GRAPHICS_MODES[number]
type RenderModeChoice = GraphicsMode | "configured"

interface Settings {
  graphicsMode: GraphicsMode | null
}

const RENDER_MODE_OPTIONS: ReadonlyArray<{
  title: string
  value: RenderModeChoice
  description: string
}> = [
  {
    title: "Use configured default",
    value: "configured",
    description: "Follow graphicsMode from plugin configuration",
  },
  {
    title: "Automatic",
    value: "auto",
    description: "Use Kitty or SIXEL when available, otherwise Unicode cells",
  },
  {
    title: "Kitty graphics",
    value: "kitty",
    description: "Force the Kitty graphics protocol",
  },
  {
    title: "Unicode cells",
    value: "cells",
    description: "Use the portable terminal-cell renderer",
  },
]

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function graphicsMode(value: unknown): GraphicsMode {
  return typeof value === "string" && GRAPHICS_MODES.includes(value as GraphicsMode)
    ? value as GraphicsMode
    : "auto"
}

function savedGraphicsMode(value: unknown): GraphicsMode | null {
  return typeof value === "string" && GRAPHICS_MODES.includes(value as GraphicsMode)
    ? value as GraphicsMode
    : null
}

function renderModeTitle(mode: GraphicsMode): string {
  return RENDER_MODE_OPTIONS.find((option) => option.value === mode)?.title ?? mode
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
    const configuredMode = graphicsMode(context.options.graphicsMode)
    const [settings, updateSettings] = context.storage.store<Settings>("settings", {
      initial: { graphicsMode: null },
    })
    const effectiveMode = (): GraphicsMode =>
      savedGraphicsMode(settings.graphicsMode) ?? configuredMode

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode.latex.render-mode",
          title: "Set default render mode",
          description: "Choose how LaTeX formulas are rendered",
          group: "LaTeX",
          palette: true,
          slash: { name: "latex-render-mode" },
          run: async () => {
            const selected = await context.ui.dialog.select<RenderModeChoice>({
              title: "LaTeX render mode",
              current: savedGraphicsMode(settings.graphicsMode) ?? "configured",
              options: RENDER_MODE_OPTIONS,
            })
            if (selected === undefined) return

            const preference = selected === "configured" ? null : selected
            await updateSettings((draft) => {
              draft.graphicsMode = preference
            })
            const mode = preference ?? configuredMode
            context.ui.toast.show({
              message: `LaTeX render mode: ${renderModeTitle(mode)}`,
              variant: "success",
            })
          },
        },
      ],
    }))

    return context.markdown.registerCodeBlockRenderer(LANGUAGE, (token, render) => {
      try {
        const renderable = new GraphicalLatexRenderable(context.renderer, {
          content: normalizeLatexSource(token.text),
          displayMode: true,
          fallback: "source",
          foregroundColor: color,
          graphicsForegroundColor: color,
          graphicsMode: effectiveMode(),
          fontSize,
          pixelRatio,
        })
        return renderable
      } catch {
        return render.defaultRender()
      }
    })
  },
})

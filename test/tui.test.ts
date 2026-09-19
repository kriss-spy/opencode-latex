import { afterEach, describe, expect, test } from "bun:test"
import type { MarkdownCodeBlockRenderer } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { GraphicalLatexRenderable } from "opentui-math/graphics"
import plugin, { normalizeLatexSource } from "../src/tui.js"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

async function setupPlugin(options: Record<string, unknown> = {}) {
  const setup = await createTestRenderer({ width: 40, height: 10 })
  cleanups.push(() => setup.renderer.destroy())

  let language: string | undefined
  let renderCodeBlock: MarkdownCodeBlockRenderer | undefined
  const unregister = () => {}
  const pluginCleanup = plugin.setup({
    renderer: setup.renderer,
    options,
    themeMode: "dark",
    markdown: {
      registerCodeBlockRenderer(nextLanguage: string, renderer: MarkdownCodeBlockRenderer) {
        language = nextLanguage
        renderCodeBlock = renderer
        return unregister
      },
    },
  } as never)

  return { language, pluginCleanup, renderCodeBlock, setup, unregister }
}

describe("TUI renderer registration", () => {
  test("removes one escape layer from globally double-escaped TeX", () => {
    const escaped = String.raw`\\begin{aligned}
I^2 &= \\left(\\int_{-\\infty}^{\\infty} e^{-x^2} dx\\right)^2 \\\\
&= 2\\pi
\\end{aligned}`
    const expected = String.raw`\begin{aligned}
I^2 &= \left(\int_{-\infty}^{\infty} e^{-x^2} dx\right)^2 \\
&= 2\pi
\end{aligned}`

    expect(normalizeLatexSource(escaped)).toBe(expected)
  })

  test("preserves correctly escaped TeX and its row breaks", () => {
    const source = String.raw`\begin{aligned} x &= 1 \\ y &= 2 \end{aligned}`
    expect(normalizeLatexSource(source)).toBe(source)
  })

  test("registers one graphical LaTeX renderer with portable cell fallback", async () => {
    const registered = await setupPlugin({ graphicsMode: "cells", color: "#abcdef" })

    expect(registered.language).toBe("latex")
    expect(registered.pluginCleanup).toBe(registered.unregister)

    const renderable = registered.renderCodeBlock!(
      { text: String.raw`\frac{1}{2}` } as never,
      { defaultRender: () => null } as never,
    )

    expect(renderable).toBeInstanceOf(GraphicalLatexRenderable)
    expect((renderable as GraphicalLatexRenderable).content).toBe(String.raw`\frac{1}{2}`)
    expect((renderable as GraphicalLatexRenderable).graphicsForegroundColor).toBe("#abcdef")
    expect((renderable as GraphicalLatexRenderable).isUsingGraphics).toBe(false)

    registered.setup.renderer.root.add(renderable!)
    await registered.setup.renderOnce()
    expect(registered.setup.captureCharFrame()).toContain("─")
  })

  test("does not hide renderer registration failures", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    cleanups.push(() => setup.renderer.destroy())

    expect(() => plugin.setup({
      renderer: setup.renderer,
      options: {},
      themeMode: "dark",
      markdown: {
        registerCodeBlockRenderer() {
          throw new Error("unexpected failure")
        },
      },
    } as never)).toThrow("unexpected failure")
  })
})

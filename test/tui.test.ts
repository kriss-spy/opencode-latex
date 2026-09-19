import { afterEach, describe, expect, test } from "bun:test"
import type { MarkdownCodeBlockRenderer } from "@opentui/core"
import { createTestRenderer, setRendererCapabilities } from "@opentui/core/testing"
import plugin, { normalizeLatexSource } from "../src/tui.js"
import { GraphicalLatexRenderable } from "../src/opentui-math.js"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

async function setupPlugin(
  options: Record<string, unknown> = {},
  capabilities?: { kitty_graphics?: boolean; sixel?: boolean },
) {
  const setup = await createTestRenderer({ width: 40, height: 10 })
  cleanups.push(() => setup.renderer.destroy())
  if (capabilities) setRendererCapabilities(setup.renderer, capabilities)

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
  test("uses SIXEL graphics when the terminal advertises SIXEL with pixel geometry", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    cleanups.push(() => setup.renderer.destroy())
    setRendererCapabilities(setup.renderer, { sixel: true, kitty_graphics: false })
    Object.defineProperty(setup.renderer, "resolution", {
      configurable: true,
      value: { width: 400, height: 200 },
    })

    const renderable = new GraphicalLatexRenderable(setup.renderer, {
      content: String.raw`\frac{1}{2}`,
    })
    setup.renderer.root.add(renderable)

    expect(await renderable.whenGraphicsReady()).toBe(true)
    expect(renderable.effectiveGraphicsProtocol).toBe("sixel")

    renderable.destroy()
  })

  test("switches from cell fallback to SIXEL when capabilities arrive after construction", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    cleanups.push(() => setup.renderer.destroy())
    const renderable = new GraphicalLatexRenderable(setup.renderer, { content: "x^2" })
    setup.renderer.root.add(renderable)

    expect(await renderable.whenGraphicsReady()).toBe(false)
    setRendererCapabilities(setup.renderer, { sixel: true, kitty_graphics: false })
    Object.defineProperty(setup.renderer, "resolution", {
      configurable: true,
      value: { width: 400, height: 200 },
    })
    setup.renderer.emit("capabilities", setup.renderer.capabilities!)

    expect(await renderable.whenGraphicsReady()).toBe(true)
    expect(renderable.effectiveGraphicsProtocol).toBe("sixel")

    renderable.destroy()
  })

  test("uses OpenTUI's Kitty protocol without writing terminal placements directly", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    cleanups.push(() => setup.renderer.destroy())
    setRendererCapabilities(setup.renderer, { kitty_graphics: true })
    const directWrites: string[] = []
    Object.defineProperty(setup.renderer, "writeTerminal", {
      configurable: true,
      value: (data: string) => {
        directWrites.push(data)
        return true
      },
    })

    const renderable = new GraphicalLatexRenderable(setup.renderer, { content: "x^2" })
    setup.renderer.root.add(renderable)

    expect(await renderable.whenGraphicsReady()).toBe(true)
    expect(renderable.effectiveGraphicsProtocol).toBe("kitty")
    await setup.renderOnce()
    expect(directWrites).toEqual([])

    renderable.destroy()
  })

  test("uses a compact graphical font size by default", async () => {
    const compact = await setupPlugin({}, { kitty_graphics: true })
    const large = await setupPlugin({ fontSize: 32 }, { kitty_graphics: true })
    const token = { text: String.raw`\int_0^\infty e^{-x^2}\,dx` } as never
    const render = { defaultRender: () => null } as never
    const compactMath = compact.renderCodeBlock!(token, render) as GraphicalLatexRenderable
    const largeMath = large.renderCodeBlock!(token, render) as GraphicalLatexRenderable
    compact.setup.renderer.root.add(compactMath)
    large.setup.renderer.root.add(largeMath)

    expect(await compactMath.whenGraphicsReady()).toBe(true)
    expect(await largeMath.whenGraphicsReady()).toBe(true)
    await compact.setup.renderOnce()
    await large.setup.renderOnce()
    expect(compactMath.height).toBeLessThan(largeMath.height)
  })

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

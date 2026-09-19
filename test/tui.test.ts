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

  test("switches to SIXEL when pixel geometry arrives after SIXEL capabilities", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    cleanups.push(() => setup.renderer.destroy())
    setRendererCapabilities(setup.renderer, { sixel: true, kitty_graphics: false })
    const renderable = new GraphicalLatexRenderable(setup.renderer, { content: "x^2" })
    setup.renderer.root.add(renderable)

    expect(await renderable.whenGraphicsReady()).toBe(false)
    expect(renderable.effectiveGraphicsProtocol).toBe("blocks")
    Object.defineProperty(setup.renderer, "resolution", {
      configurable: true,
      value: { width: 400, height: 200 },
    })
    await setup.renderOnce()

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

  test("decodes graphics with the host buffer's OpenTUI runtime", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    cleanups.push(() => setup.renderer.destroy())
    setRendererCapabilities(setup.renderer, { kitty_graphics: true })
    const renderable = new GraphicalLatexRenderable(setup.renderer, { content: "x^2" })
    setup.renderer.root.add(renderable)
    expect(await renderable.whenGraphicsReady()).toBe(true)
    await setup.renderOnce()

    const handle = {}
    let decodeCount = 0
    let destroyed: unknown
    let drawnImage: { ptr: unknown } | undefined
    const fakeBuffer = {
      lib: {
        imageDecode() {
          decodeCount++
          return { status: 0, handle }
        },
        imageDestroy(value: unknown) {
          destroyed = value
        },
      },
      drawImage(image: { ptr: unknown }) {
        drawnImage = image
        return true
      },
    }

    ;(renderable as unknown as { renderGraphics(buffer: unknown): void })
      .renderGraphics(fakeBuffer)
    expect(decodeCount).toBe(1)
    expect(drawnImage?.ptr).toBe(handle)

    renderable.destroy()
    expect(destroyed).toBe(handle)
  })

  test("uses a readable graphical font size by default", async () => {
    const standard = await setupPlugin({}, { kitty_graphics: true })
    const explicitStandard = await setupPlugin({ fontSize: 20 }, { kitty_graphics: true })
    const large = await setupPlugin({ fontSize: 32 }, { kitty_graphics: true })
    const token = { text: String.raw`\int_0^\infty e^{-x^2}\,dx` } as never
    const render = { defaultRender: () => null } as never
    const standardMath = standard.renderCodeBlock!(token, render) as GraphicalLatexRenderable
    const explicitStandardMath = explicitStandard.renderCodeBlock!(token, render) as GraphicalLatexRenderable
    const largeMath = large.renderCodeBlock!(token, render) as GraphicalLatexRenderable
    standard.setup.renderer.root.add(standardMath)
    explicitStandard.setup.renderer.root.add(explicitStandardMath)
    large.setup.renderer.root.add(largeMath)

    expect(await standardMath.whenGraphicsReady()).toBe(true)
    expect(await explicitStandardMath.whenGraphicsReady()).toBe(true)
    expect(await largeMath.whenGraphicsReady()).toBe(true)
    await standard.setup.renderOnce()
    await explicitStandard.setup.renderOnce()
    await large.setup.renderOnce()
    expect(standardMath.height).toBe(explicitStandardMath.height)
    expect(standardMath.height).toBeLessThan(largeMath.height)
  })

  test("keeps a stable cell footprint while using terminal pixel geometry", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    cleanups.push(() => setup.renderer.destroy())
    setRendererCapabilities(setup.renderer, { kitty_graphics: true })
    Object.defineProperty(setup.renderer, "resolution", {
      configurable: true,
      value: { width: 400, height: 200 },
    })
    const renderable = new GraphicalLatexRenderable(setup.renderer, {
      content: String.raw`I=\int_{-\infty}^{\infty}e^{-x^2}\,dx`,
      fontSize: 20,
      pixelRatio: 1,
    })
    setup.renderer.root.add(renderable)

    expect(await renderable.whenGraphicsReady()).toBe(true)
    await setup.renderOnce()
    expect(renderable.height).toBe(4)

    renderable.destroy()
  })

  test("keeps single-line and multiline graphics at one pixel scale", async () => {
    const setup = await createTestRenderer({ width: 120, height: 40 })
    cleanups.push(() => setup.renderer.destroy())
    setRendererCapabilities(setup.renderer, { kitty_graphics: true })
    Object.defineProperty(setup.renderer, "resolution", {
      configurable: true,
      value: { width: 1200, height: 800 },
    })
    const placements: Array<{ pixelWidth: number; pixelHeight: number; sourceWidth: number; sourceHeight: number }> = []
    const buffer = setup.renderer.nextRenderBuffer
    Object.defineProperty(buffer, "drawImage", {
      configurable: true,
      value: (
        _image: unknown,
        _x: number,
        _y: number,
        _width: number,
        _height: number,
        pixelWidth: number,
        pixelHeight: number,
        _sourceX: number,
        _sourceY: number,
        sourceWidth: number,
        sourceHeight: number,
      ) => {
        placements.push({ pixelWidth, pixelHeight, sourceWidth, sourceHeight })
        return true
      },
    })
    const single = new GraphicalLatexRenderable(setup.renderer, {
      content: String.raw`I=\int_{-\infty}^{\infty}e^{-x^2}\,dx`,
      fontSize: 20,
      pixelRatio: 2,
    })
    const multiline = new GraphicalLatexRenderable(setup.renderer, {
      content: String.raw`\begin{aligned} I^2 &= \pi \\ I &= \sqrt{\pi} \end{aligned}`,
      fontSize: 20,
      pixelRatio: 2,
    })
    setup.renderer.root.add(single)
    setup.renderer.root.add(multiline)

    expect(await single.whenGraphicsReady()).toBe(true)
    expect(await multiline.whenGraphicsReady()).toBe(true)
    await setup.renderOnce()
    expect(placements).toHaveLength(2)
    const widthScale = placements[0]!.pixelWidth / placements[0]!.sourceWidth
    const heightScale = placements[0]!.pixelHeight / placements[0]!.sourceHeight
    for (const placement of placements) {
      expect(placement.pixelWidth / placement.sourceWidth).toBeCloseTo(widthScale, 1)
      expect(placement.pixelHeight / placement.sourceHeight).toBeCloseTo(heightScale, 1)
    }

    single.destroy()
    multiline.destroy()
  })

  test("scales graphics with terminal cell zoom", async () => {
    const setup = await createTestRenderer({ width: 120, height: 40 })
    cleanups.push(() => setup.renderer.destroy())
    setRendererCapabilities(setup.renderer, { kitty_graphics: true })
    let resolution = { width: 1200, height: 800 }
    Object.defineProperty(setup.renderer, "resolution", {
      configurable: true,
      get: () => resolution,
    })
    const placements: Array<{ pixelWidth: number; pixelHeight: number }> = []
    Object.defineProperty(setup.renderer.nextRenderBuffer, "drawImage", {
      configurable: true,
      value: (
        _image: unknown,
        _x: number,
        _y: number,
        _width: number,
        _height: number,
        pixelWidth: number,
        pixelHeight: number,
      ) => {
        placements.push({ pixelWidth, pixelHeight })
        return true
      },
    })
    const renderable = new GraphicalLatexRenderable(setup.renderer, {
      content: String.raw`I=\int_{-\infty}^{\infty}e^{-x^2}\,dx`,
      fontSize: 20,
      pixelRatio: 2,
    })
    setup.renderer.root.add(renderable)
    expect(await renderable.whenGraphicsReady()).toBe(true)
    await setup.renderOnce()
    const normal = placements.at(-1)!

    resolution = { width: 2400, height: 1600 }
    setup.renderer.emit("resize", setup.renderer.terminalWidth, setup.renderer.terminalHeight)
    await setup.renderOnce()
    const zoomed = placements.at(-1)!

    expect(zoomed.pixelWidth / normal.pixelWidth).toBeCloseTo(2, 1)
    expect(zoomed.pixelHeight / normal.pixelHeight).toBeCloseTo(2, 1)
    renderable.destroy()
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

  test("preserves optional spacing after an aligned row break", () => {
    const source = String.raw`\begin{aligned} x &= 1 \\[4pt] y &= 2 \end{aligned}`
    expect(normalizeLatexSource(source)).toBe(source)
  })

  test("repairs mixed double-escaped commands without changing row breaks", async () => {
    const registered = await setupPlugin({}, { sixel: true, kitty_graphics: false })
    Object.defineProperty(registered.setup.renderer, "resolution", {
      configurable: true,
      value: { width: 400, height: 200 },
    })
    const source = String.raw`\\begin{aligned}
I^2 &= \\left(\\int_{-\\infty}^{\\infty} e^{-x^2} dx\\right)^2 \\\\
&= \int_0^1 1\,dx
\\end{aligned}`
    const expected = String.raw`\begin{aligned}
I^2 &= \left(\int_{-\infty}^{\infty} e^{-x^2} dx\right)^2 \\
&= \int_0^1 1\,dx
\end{aligned}`

    const renderable = registered.renderCodeBlock!(
      { text: source } as never,
      { defaultRender: () => null } as never,
    ) as GraphicalLatexRenderable
    registered.setup.renderer.root.add(renderable)

    expect(renderable.content).toBe(expected)
    expect(renderable.latexError).toBeDefined()
    expect(await renderable.whenGraphicsReady()).toBe(true)
    renderable.destroy()
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

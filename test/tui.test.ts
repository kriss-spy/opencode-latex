import { afterEach, describe, expect, test } from "bun:test"
import { NativeImage, MarkdownRenderable, SyntaxStyle, TextRenderable, createMarkdownCodeBlockRenderer, type MarkdownCodeBlockRenderer } from "@opentui/core"
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
  initialRenderMode: "auto" | "kitty" | "cells" | null = null,
) {
  const setup = await createTestRenderer({ width: 40, height: 10 })
  cleanups.push(() => setup.renderer.destroy())
  if (capabilities) setRendererCapabilities(setup.renderer, capabilities)

  let language: string | undefined
  let renderCodeBlock: MarkdownCodeBlockRenderer | undefined
  let command: {
    title?: string
    group?: string
    palette?: boolean
    slash?: { name: string }
    run: () => Promise<void>
  } | undefined
  let selectedMode: "configured" | "auto" | "kitty" | "cells" | undefined
  let selectInput: {
    current?: "configured" | "auto" | "kitty" | "cells"
    options: Array<{ value: "configured" | "auto" | "kitty" | "cells" }>
  } | undefined
  const settings = { graphicsMode: initialRenderMode }
  const toasts: Array<{ message: string }> = []
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
    storage: {
      store() {
        return [settings, async (mutation: (draft: typeof settings) => void) => mutation(settings)]
      },
    },
    keymap: {
      layer(factory: () => { commands?: Array<typeof command> }) {
        command = factory().commands?.[0]
      },
    },
    ui: {
      dialog: {
        async select(input: typeof selectInput) {
          selectInput = input
          return selectedMode
        },
      },
      toast: {
        show(input: { message: string }) {
          toasts.push(input)
        },
      },
    },
  } as never)

  return {
    command,
    language,
    pluginCleanup,
    renderCodeBlock,
    selectInput: () => selectInput,
    selectMode(mode: typeof selectedMode) {
      selectedMode = mode
    },
    settings,
    setup,
    toasts,
    unregister,
  }
}

describe("TUI renderer registration", () => {
  test("coexists with built-in latex and math contributions under the host's last-wins rule", async () => {
    const registered = await setupPlugin({ graphicsMode: "cells" })
    expect(plugin.id).toBe("io.github.kriss-spy.opencode-latex.tui")
    const builtin: MarkdownCodeBlockRenderer = () => new TextRenderable(registered.setup.renderer, {
      content: "Built-in math", height: 1,
    })
    // OpenCode 2.2.2 packages/tui/src/plugin/markdown.ts folds registrations
    // in this order. Duplicate checks apply within each plugin, not globally.
    const contributions = [{ latex: builtin, math: builtin }, { latex: registered.renderCodeBlock! }]
    const markdown = new MarkdownRenderable(registered.setup.renderer, {
      syntaxStyle: SyntaxStyle.fromStyles({}, registered.setup.renderer.nativeScene),
      renderNode: createMarkdownCodeBlockRenderer(Object.assign({}, ...contributions)),
      content: "```latex\n\\frac{1}{2}\n```\n\n```math\nx^2\n```",
    })
    registered.setup.renderer.root.add(markdown)
    await registered.setup.renderOnce()
    const frame = registered.setup.captureCharFrame()
    expect(frame).toContain("─")
    expect(frame).toContain("Built-in math")
  })

  test("imports with the newer host's Unicode registry metadata", () => {
    const result = Bun.spawnSync([process.execPath, "--eval", `
      globalThis[Symbol.for("@opentui/core/singleton")] = {
        "env-registry": { OPENTUI_FORCE_UNICODE: {
          name: "OPENTUI_FORCE_UNICODE",
          description: "Use the Unicode width method (mode 2027) when the variable is present",
          type: "string", required: false,
        } },
      };
      await import(${JSON.stringify(new URL("../src/tui.ts", import.meta.url).href)});
    `])
    expect(result.stderr.toString()).toBe("")
    expect(result.exitCode).toBe(0)
  })
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

  test("uses a host-owned native image and disposes it on destruction", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    cleanups.push(() => setup.renderer.destroy())
    setRendererCapabilities(setup.renderer, { kitty_graphics: true })
    const renderable = new GraphicalLatexRenderable(setup.renderer, { content: "x^2" })
    setup.renderer.root.add(renderable)
    expect(await renderable.whenGraphicsReady()).toBe(true)
    await setup.renderOnce()
    let drawn: NativeImage | undefined
    const draw = () => (renderable as unknown as { renderGraphics(buffer: unknown): void }).renderGraphics({
      drawImage(image: NativeImage) { drawn = image; return true },
    })
    draw()
    expect(drawn).toBeInstanceOf(NativeImage)
    const first = drawn!
    expect(first.width).toBeGreaterThan(0)
    draw()
    expect(drawn).toBe(first)
    renderable.destroy()
    expect(() => first.raw()).toThrow()
  })

  test("reuses padded SIXEL images across scrolling and preserves transparency", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    cleanups.push(() => setup.renderer.destroy())
    setRendererCapabilities(setup.renderer, { sixel: true, kitty_graphics: false })
    Object.defineProperty(setup.renderer, "resolution", {
      configurable: true, value: { width: 400, height: 200 },
    })
    const renderable = new GraphicalLatexRenderable(setup.renderer, { content: String.raw`\frac{1}{2}` })
    setup.renderer.root.add(renderable)
    expect(await renderable.whenGraphicsReady()).toBe(true)
    // Native recording buffers do not expose raw background planes.
    // Rendering must succeed using the public image API alone.
    await setup.renderOnce()
    const placements: Array<{ image: NativeImage; columns: number; rows: number; width: number; height: number }> = []
    const buffer = {
      get buffers(): never { throw new Error("raw paint-buffer access") },
      drawImage(image: NativeImage, _x: number, _y: number, columns: number, rows: number, width: number, height: number) {
        placements.push({ image, columns, rows, width, height })
        return true
      },
    }
    const draw = () => (renderable as unknown as { renderGraphics(buffer: unknown): void }).renderGraphics(buffer)
    draw()
    const first = placements.at(-1)!
    expect(first.width).toBe(first.columns * 10)
    expect(first.height).toBe(first.rows * 20)
    const pixels = first.image.raw()
    expect(pixels.data.at(-1)).toBe(0)
    renderable.y = 1
    await setup.renderOnce()
    draw()
    expect(placements.at(-1)!.image).toBe(first.image)
    renderable.destroy()
    expect(() => first.image.raw()).toThrow()
  })

  test("keeps transparent source pixels for Kitty graphics", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    cleanups.push(() => setup.renderer.destroy())
    setRendererCapabilities(setup.renderer, { kitty_graphics: true })
    const renderable = new GraphicalLatexRenderable(setup.renderer, { content: "x" })
    setup.renderer.root.add(renderable)
    expect(await renderable.whenGraphicsReady()).toBe(true)
    await setup.renderOnce()
    let pixels: Uint8Array | undefined
    ;(renderable as unknown as { renderGraphics(buffer: unknown): void }).renderGraphics({
      drawImage(image: NativeImage) { pixels = image.raw().data; return true },
    })
    expect(pixels!.some((value, index) => index % 4 === 3 && value === 0)).toBe(true)
    renderable.destroy()
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
    const buffer = { }
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
    for (const renderable of [single, multiline]) {
      ;(renderable as unknown as { renderGraphics(buffer: unknown): void }).renderGraphics(buffer)
    }
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
    const buffer = {}
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
    ;(renderable as unknown as { renderGraphics(buffer: unknown): void }).renderGraphics(buffer)
    const normal = placements.at(-1)!

    resolution = { width: 2400, height: 1600 }
    setup.renderer.emit("resize", setup.renderer.terminalWidth, setup.renderer.terminalHeight)
    await setup.renderOnce()
    ;(renderable as unknown as { renderGraphics(buffer: unknown): void }).renderGraphics(buffer)
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

  test("uses a persisted render mode in preference to plugin configuration", async () => {
    const registered = await setupPlugin(
      { graphicsMode: "kitty" },
      { kitty_graphics: true },
      "cells",
    )

    const renderable = registered.renderCodeBlock!(
      { text: "x^2" } as never,
      { defaultRender: () => null } as never,
    ) as GraphicalLatexRenderable

    expect(await renderable.whenGraphicsReady()).toBe(false)
    renderable.destroy()
  })

  test("exposes a command that changes the default render mode", async () => {
    const registered = await setupPlugin({}, { kitty_graphics: true })
    const existing = registered.renderCodeBlock!(
      { text: "x^2" } as never,
      { defaultRender: () => null } as never,
    ) as GraphicalLatexRenderable
    expect(await existing.whenGraphicsReady()).toBe(true)

    registered.selectMode("cells")
    await registered.command!.run()

    expect(registered.command?.title).toBe("Set default render mode")
    expect(registered.command?.group).toBe("LaTeX")
    expect(registered.command?.palette).toBe(true)
    expect(registered.command?.slash?.name).toBe("latex-render-mode")
    expect(registered.selectInput()?.current).toBe("configured")
    expect(registered.selectInput()?.options.map(({ value }) => value)).toEqual([
      "configured",
      "auto",
      "kitty",
      "cells",
    ])
    expect(registered.settings.graphicsMode).toBe("cells")
    const next = registered.renderCodeBlock!(
      { text: "y^2" } as never,
      { defaultRender: () => null } as never,
    ) as GraphicalLatexRenderable
    expect(await existing.whenGraphicsReady()).toBe(true)
    expect(await next.whenGraphicsReady()).toBe(false)
    expect(registered.toasts.at(-1)?.message).toContain("Unicode cells")
    existing.destroy()
    next.destroy()
  })

  test("can reset the UI preference to the configured default", async () => {
    const registered = await setupPlugin(
      { graphicsMode: "kitty" },
      { kitty_graphics: true },
      "cells",
    )
    const existing = registered.renderCodeBlock!(
      { text: "x^2" } as never,
      { defaultRender: () => null } as never,
    ) as GraphicalLatexRenderable
    expect(await existing.whenGraphicsReady()).toBe(false)

    registered.selectMode("configured")
    await registered.command!.run()

    expect(registered.selectInput()?.current).toBe("cells")
    expect(registered.settings.graphicsMode).toBeNull()
    const next = registered.renderCodeBlock!(
      { text: "y^2" } as never,
      { defaultRender: () => null } as never,
    ) as GraphicalLatexRenderable
    expect(await existing.whenGraphicsReady()).toBe(false)
    expect(await next.whenGraphicsReady()).toBe(true)
    existing.destroy()
    next.destroy()
  })

  test("does not hide renderer registration failures", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    cleanups.push(() => setup.renderer.destroy())

    expect(() => plugin.setup({
      renderer: setup.renderer,
      options: {},
      themeMode: "dark",
      storage: {
        store() {
          return [{ graphicsMode: null }, async () => {}]
        },
      },
      keymap: { layer() {} },
      ui: {
        dialog: { select: async () => undefined },
        toast: { show() {} },
      },
      markdown: {
        registerCodeBlockRenderer() {
          throw new Error("unexpected failure")
        },
      },
    } as never)).toThrow("unexpected failure")
  })
})

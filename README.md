# opencode-latex

Render readable LaTeX in OpenCode v2 terminal conversations.

`opencode-latex` has two coordinated parts:

- The server plugin teaches agents to use compact Unicode for simple inline math and fenced `latex` blocks for longer expressions.
- The TUI plugin renders those blocks with [`opentui-math`](https://opentui-math.dev/) through OpenTUI's image pipeline.

Graphical output uses Kitty graphics in terminals such as Ghostty and Kitty, or SIXEL in compatible xterm.js terminals such as `obsidian-opencode`. Other terminals and multiplexers receive a selectable Unicode-cell fallback.

> [!NOTE]
> This is an initial `0.1.x` release. Kitty output preserves real PNG transparency. SIXEL output is composited against the covered OpenTUI cell backgrounds because SIXEL cannot reproduce Kitty's alpha compositing exactly.

## Requirements

- OpenCode v2
- A terminal with Kitty graphics or SIXEL for graphical output
- No external TeX installation; MathJax performs the rendering

## Install

Install the package globally through OpenCode:

```sh
opencode plugin add opencode-latex@0.1.1
```

Alternatively, add it to `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-latex@0.1.1"]
}
```

The package's `./tui` companion is loaded automatically by the OpenCode v2 CLI. Restart OpenCode after installing or updating the package.

For local development, configure the repository path instead:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-latex"]
}
```

## Use

Ask OpenCode a math-heavy question normally. The plugin's server instruction tells the agent when to use Unicode inline math and when to emit a rendered block.

To test the renderer directly, send a fenced block:

````markdown
```latex
\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
```
````

Long derivations should use compact rows:

````markdown
```latex
\begin{aligned}
I^2 &= \int_0^{2\pi}\int_0^\infty e^{-r^2}r\,dr\,d\theta \\
    &= 2\pi\left[-\frac12 e^{-r^2}\right]_0^\infty \\
    &= \pi
\end{aligned}
```
````

Use the `latex` fence exactly; this plugin registers that language without replacing other Markdown renderers.

## Options

Options are optional:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-latex@0.1.1",
      "options": {
        "color": "#d4d4d4",
        "graphicsMode": "auto",
        "fontSize": 20,
        "pixelRatio": 2
      }
    }
  ]
}
```

- `color` sets the equation foreground. Its default follows OpenCode's light or dark theme.
- `graphicsMode` selects `"auto"`, forced `"kitty"`, or portable `"cells"` rendering. The default is `"auto"`.
- `fontSize` sets the graphical MathJax font size. The default is `20`.
- `pixelRatio` increases raster sharpness without changing the intended cell footprint. The default is `2`.

## Troubleshooting

### Renderer already registered

If startup reports `Markdown code-block renderer already registered: latex`, the plugin is loaded more than once. Remove the older local copy or duplicate config entry, then restart OpenCode. Check both the global `~/.config/opencode/plugins/` directory and project `.opencode/plugins/` directories.

### Raw red LaTeX

The fallback source renderer appears when a formula is invalid or graphical rendering fails. Each TeX command should use one backslash; only aligned or matrix row breaks use two.

### Graphical output is unavailable

Leave `graphicsMode` on `"auto"`. OpenTUI will use Kitty, then SIXEL when current pixel geometry is available, then Unicode cells. tmux and terminals without a supported graphics protocol normally use the cell fallback.

## Develop

```sh
bun install
bun run check
npm pack --dry-run
```

The narrow `opentui-math` transport fork is in `src/opentui-math.ts`. It keeps upstream MathJax rasterization and Unicode fallback while routing graphical placement, cleanup, terminal zoom, and SIXEL background compositing through the host OpenTUI runtime.

## License

MIT

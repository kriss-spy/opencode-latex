# opencode-latex

An OpenCode v2 plugin that renders LaTeX in agent messages with [`opentui-math`](https://opentui-math.dev/).

The server plugin asks agents to emit display equations in fenced `latex` blocks. The CLI plugin renders those blocks as high-resolution MathJax graphics through OpenTUI's native image pipeline: Kitty graphics in terminals such as Ghostty and SIXEL in compatible xterm.js terminals. It automatically falls back to selectable Unicode cells everywhere else. If a renderable cannot be created, OpenCode's normal fenced-code renderer is used instead.

## Install

Add the package to your OpenCode configuration:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-latex"]
}
```

The exported `./tui` companion is discovered automatically by OpenCode v2. For local development, use the repository path instead:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-latex"]
}
```

Restart OpenCode after installing a local package plugin. Then ask for an equation, or test it with:

````markdown
```latex
\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
```
````

## Options

Options are optional and apply to the CLI renderer:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-latex",
      "options": {
        "color": "#d4d4d4",
        "graphicsMode": "auto",
        "fontSize": 16,
        "pixelRatio": 2
      }
    }
  ]
}
```

- `color` sets the equation foreground. It defaults to a light or dark theme-aware value.
- `graphicsMode` selects `"auto"`, `"kitty"`, or portable `"cells"` rendering.
- `fontSize` controls the graphical MathJax font size and defaults to `16`.
- `pixelRatio` increases graphical raster sharpness without changing the cell footprint.

## Develop

```sh
bun install
bun run typecheck
bun test
```

Requires OpenCode v2. High-resolution output is available through Kitty graphics in Ghostty, Kitty, and WezTerm, or through SIXEL in compatible terminals such as `obsidian-opencode`. Other terminals and multiplexers use the Unicode-cell renderer.

The narrow `opentui-math` transport fork lives in `src/opentui-math.ts`. It continues to use the upstream package for MathJax rasterization and Unicode-cell fallback while routing graphical output through OpenTUI.

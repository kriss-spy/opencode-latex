# opencode-latex

An OpenCode v2 plugin that renders LaTeX in agent messages as terminal images.

The server plugin asks agents to emit display equations in fenced `latex` blocks. The CLI plugin turns those blocks into PNGs with MathJax and displays them through OpenTUI. If an expression cannot be rendered, OpenCode's normal fenced-code renderer is used instead.

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
        "scale": 2,
        "cellWidth": 8,
        "cellHeight": 16
      }
    }
  ]
}
```

- `color` sets the equation foreground. It defaults to a light or dark theme-aware value.
- `scale` controls raster resolution.
- `cellWidth` and `cellHeight` tune pixel-to-terminal-cell sizing for a terminal font.

## Develop

```sh
bun install
bun run typecheck
bun test
```

Requires OpenCode v2 and a terminal supported by OpenTUI's image renderer. OpenTUI falls back to block rendering when Kitty or Sixel graphics are unavailable.

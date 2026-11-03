# Changelog

All notable changes to this project are documented here.

## 0.2.1 - 2026-11-03

- Uses `io.github.kriss-spy.opencode-latex` and `io.github.kriss-spy.opencode-latex.tui` IDs to avoid OpenCode's built-in `opencode.latex` ID.
- Targets OpenCode 2.2.2 and Core 0.7.x. Uses the host's per-plugin renderer registration so graphical `latex` and built-in `math` coexist.
- Replaces the Core `<0.6.0` cap with Core 0.7.x compatibility. Adapts `opentui-math` measurement to the public host API.
- Uses host-owned `NativeImage` resources instead of private image-library handles and raw paint-buffer access.
- Reuses padded SIXEL images across position changes. Native OpenTUI handles SIXEL transparency and encoding; this replaces JavaScript background compositing.
- Documents the built-in Unicode renderer, version requirements, troubleshooting, and the one-time render-mode preference reset.
- Includes the existing README demo images in the npm package.

## 0.2.0 - 2026-09-19

- Adds a **LaTeX: Set default render mode** command to the command palette and `/latex-render-mode` slash command.
- Persists the selected automatic, Kitty, or Unicode-cell mode across TUI restarts.
- Applies the selected default whenever LaTeX formulas are rendered.
- Allows the saved preference to be cleared so plugin configuration becomes authoritative again.

## 0.1.1 - 2026-09-19

- Removes visible right and bottom seams around SIXEL-rendered formulas in embedded xterm.js terminals such as `obsidian-opencode`.
- Pads SIXEL images to complete terminal-cell boundaries while preserving the formula's pixel scale.
- Adds regression coverage for sub-cell image dimensions and background compositing.

## 0.1.0 - 2026-09-19

Initial public release.

- Adds an OpenCode v2 server instruction for readable inline and display math.
- Registers graphical rendering for fenced `latex` blocks without replacing other Markdown renderers.
- Uses Kitty graphics or SIXEL when supported, with selectable Unicode-cell fallback.
- Preserves a consistent formula scale across single-line and multiline expressions.
- Tracks terminal zoom without permanently enlarging later formulas.
- Normalizes commonly double-escaped model output while preserving TeX row breaks.
- Composites SIXEL images against OpenTUI cell backgrounds for embedded xterm.js terminals.

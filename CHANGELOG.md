# Changelog

All notable changes to this project are documented here.

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

import { describe, expect, test } from "bun:test"
import { imageInfo } from "@opentui/core"
import { latexToSvg, normalizeLatex, renderLatex } from "../src/render.js"

describe("normalizeLatex", () => {
  test("removes common display delimiters", () => {
    expect(normalizeLatex(" $$ x^2 $$ ")).toBe("x^2")
    expect(normalizeLatex("\\[\\frac{1}{2}\\]")).toBe("\\frac{1}{2}")
  })

  test("preserves bare TeX", () => {
    expect(normalizeLatex("  E = mc^2  ")).toBe("E = mc^2")
  })
})

describe("LaTeX rendering", () => {
  test("creates an SVG with the requested foreground color", () => {
    const svg = latexToSvg("x^2 + y^2", "#abcdef")
    expect(svg).toContain("<svg")
    expect(svg).toContain("#abcdef")
    expect(svg).not.toContain("currentColor")
  })

  test("creates a decodable PNG", () => {
    const result = renderLatex("\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}")
    const info = imageInfo(result.png)

    expect(info.format).toBe("png")
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
    expect(info.width).toBe(result.width)
    expect(info.height).toBe(result.height)
  })

  test("rejects empty source", () => {
    expect(() => renderLatex("   ")).toThrow("LaTeX source is empty")
  })
})

import { describe, expect, test } from "bun:test"
import { imageInfo, NativeImage } from "@opentui/core"
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
    expect(result.width).toBeGreaterThan(result.displayWidth)
    expect(result.height).toBeGreaterThan(result.displayHeight)
  })

  test("can increase raster density without changing display size", () => {
    const source = "\\frac{xxxxxxx}{yyyyyyy}"
    const standard = renderLatex(source, { pixelRatio: 1 })
    const sharp = renderLatex(source, { pixelRatio: 3 })

    expect(sharp.displayWidth).toBe(standard.displayWidth)
    expect(sharp.displayHeight).toBe(standard.displayHeight)
    expect(Math.ceil(sharp.displayWidth / 8)).toBe(Math.ceil(standard.displayWidth / 8))
    expect(Math.ceil(sharp.displayHeight / 16)).toBe(Math.ceil(standard.displayHeight / 16))
    expect(Math.ceil(sharp.displayWidth / 8)).toBe(16)
    expect(sharp.width).toBeGreaterThan(standard.width)
    expect(sharp.height).toBeGreaterThan(standard.height)
  })

  test("renders Unicode text with system fonts", () => {
    const result = renderLatex("\\text{速度}")
    const image = NativeImage.decode(result.png)

    try {
      const pixels = image.raw().data
      expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
    } finally {
      image.dispose()
    }
  })

  test("rejects empty source", () => {
    expect(() => renderLatex("   ")).toThrow("LaTeX source is empty")
  })
})

import { Resvg } from "@resvg/resvg-js"
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js"
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js"
import { TeX } from "mathjax-full/js/input/tex.js"
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js"
import { mathjax } from "mathjax-full/js/mathjax.js"
import { SVG } from "mathjax-full/js/output/svg.js"

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)

const document = mathjax.document("", {
  InputJax: new TeX({ packages: AllPackages }),
  OutputJax: new SVG({ fontCache: "local" }),
})

export interface RenderLatexOptions {
  color?: string
  scale?: number
}

export interface RenderedLatex {
  png: Uint8Array
  width: number
  height: number
}

export function normalizeLatex(source: string): string {
  const value = source.trim()
  if (value.startsWith("$$") && value.endsWith("$$")) return value.slice(2, -2).trim()
  if (value.startsWith("\\[") && value.endsWith("\\]")) return value.slice(2, -2).trim()
  return value
}

export function latexToSvg(source: string, color = "#d4d4d4"): string {
  const latex = normalizeLatex(source)
  if (!latex) throw new Error("LaTeX source is empty")

  const node = document.convert(latex, { display: true })
  const markup = adaptor.outerHTML(node)
  const start = markup.indexOf("<svg")
  const end = markup.lastIndexOf("</svg>")
  if (start === -1 || end === -1) throw new Error("MathJax did not produce an SVG")
  return markup.slice(start, end + "</svg>".length).replaceAll("currentColor", color)
}

export function renderLatex(source: string, options: RenderLatexOptions = {}): RenderedLatex {
  const svg = latexToSvg(source, options.color)
  const rendered = new Resvg(svg, {
    fitTo: { mode: "zoom", value: options.scale ?? 2 },
    font: { loadSystemFonts: true },
  }).render()

  return {
    png: rendered.asPng(),
    width: rendered.width,
    height: rendered.height,
  }
}

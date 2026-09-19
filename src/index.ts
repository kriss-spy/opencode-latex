import { Plugin } from "@opencode/plugin"

const LATEX_INSTRUCTION = `Use Unicode only for short, simple inline mathematics that remains easy to read, such as π, θ, x², aₙ, √x, and ∞. Never use $...$ or \\(...\\) for inline mathematics.

Put every long, nested, multi-step, or visually awkward formula in a fenced code block labelled latex, even when it occurs in the middle of an explanation. Do not compromise readability by forcing a long formula into Unicode. Put only the TeX expression inside the block. For example:

\`\`\`latex
\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
\`\`\`

Each TeX command must begin with exactly one backslash, for example \\frac, \\int, or \\begin. Use exactly two backslashes only for a TeX row break inside an aligned or matrix environment. Do not JSON-escape or double every backslash.

Keep every display row compact so it remains readable in a narrow terminal. Split long derivations across rows in an aligned environment, with one meaningful step per row. Never chain several long equalities on one row.

Never put \\[...\\] in normal prose; OpenCode will show it as raw text. Do not wrap fenced expressions in dollar signs or \\[...\\]. If an inline expression cannot be written clearly with a few Unicode symbols, render it as a latex block instead.`

export default Plugin.define({
  id: "opencode.latex",
  async setup(context) {
    await context.session.hook("context", (event) => {
      event.system.push({ type: "text", text: LATEX_INSTRUCTION })
    })
  },
})

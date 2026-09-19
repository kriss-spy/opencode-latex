import { Plugin } from "@opencode/plugin"

const LATEX_INSTRUCTION = `Use Unicode only for short, simple inline mathematics that remains easy to read, such as π, θ, x², aₙ, √x, and ∞. Never use $...$ or \\(...\\) for inline mathematics.

Put every long, nested, multi-step, or visually awkward formula in a fenced code block labelled latex, even when it occurs in the middle of an explanation. Do not compromise readability by forcing a long formula into Unicode. Put only the TeX expression inside the block. For example:

\`\`\`latex
\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
\`\`\`

Do not wrap fenced expressions in dollar signs or \\[...\\]. If an inline expression cannot be written clearly with a few Unicode symbols, render it as a latex block instead.`

export default Plugin.define({
  id: "opencode.latex",
  async setup(context) {
    await context.session.hook("context", (event) => {
      event.system.push({ type: "text", text: LATEX_INSTRUCTION })
    })
  },
})

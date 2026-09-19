import { Plugin } from "@opencode/plugin"

const LATEX_INSTRUCTION = `When an answer contains display mathematics that benefits from typesetting, put only the TeX expression in a fenced code block labelled latex. For example:

\`\`\`latex
\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
\`\`\`

Do not wrap the expression in dollar signs or \\[...\\]. Use ordinary inline text for small inline expressions.`

export default Plugin.define({
  id: "opencode.latex",
  async setup(context) {
    await context.session.hook("context", (event) => {
      event.system.push({ type: "text", text: LATEX_INSTRUCTION })
    })
  },
})

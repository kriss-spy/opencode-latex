import { describe, expect, test } from "bun:test"
import plugin from "../src/index.js"

describe("agent formatting instruction", () => {
  test("reserves Unicode for short inline math and renders long formulas", async () => {
    let applyContext: ((event: { system: Array<{ type: string; text: string }> }) => void) | undefined

    await plugin.setup({
      session: {
        async hook(name: string, callback: typeof applyContext) {
          expect(name).toBe("context")
          applyContext = callback
        },
      },
    } as never)

    const event = { system: [] as Array<{ type: string; text: string }> }
    applyContext!(event)
    const instruction = event.system[0]?.text ?? ""

    expect(instruction).toContain("short, simple inline mathematics")
    expect(instruction).toContain("Never use $...$ or \\(...\\) for inline mathematics")
    expect(instruction).toContain("long, nested, multi-step, or visually awkward")
    expect(instruction).toContain("Do not compromise readability by forcing a long formula into Unicode")
    expect(instruction).toContain("fenced code block labelled latex")
  })
})

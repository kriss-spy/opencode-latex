import { describe, expect, test } from "bun:test"
import plugin from "../src/tui.js"

function context(register: (language: string) => () => void) {
  return {
    options: {},
    themeMode: "dark",
    markdown: { registerCodeBlockRenderer: register },
  } as never
}

describe("TUI renderer registration", () => {
  test("continues when a language is already registered", () => {
    const registered: string[] = []
    const cleanup = plugin.setup(context((language) => {
      if (language === "latex") {
        throw { toString: () => "Error: Markdown code-block renderer already registered: latex" }
      }
      registered.push(language)
      return () => {}
    }))

    expect(registered).toEqual([])
    expect(cleanup).toBeUndefined()
  })

  test("does not hide unexpected setup failures", () => {
    expect(() => plugin.setup(context(() => {
      throw new Error("unexpected failure")
    }))).toThrow("unexpected failure")
  })
})

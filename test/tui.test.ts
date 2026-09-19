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
  test("registers each distinct OpenCode language once", () => {
    const registered: string[] = []
    const unregistered: string[] = []
    const cleanup = plugin.setup(context((language) => {
      registered.push(language)
      return () => unregistered.push(language)
    }))

    expect(registered).toEqual(["latex", "math"])
    expect(cleanup).toBeFunction()
    if (typeof cleanup === "function") cleanup()
    expect(unregistered).toEqual(["latex", "math"])
  })

  test("does not hide registration failures", () => {
    expect(() => plugin.setup(context(() => {
      throw new Error("Markdown code-block renderer already registered: latex")
    }))).toThrow("Markdown code-block renderer already registered: latex")
  })
})

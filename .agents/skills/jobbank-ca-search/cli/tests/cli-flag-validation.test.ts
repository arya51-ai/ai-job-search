import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"

function errorOf(stderr: string): { error: string; code: string } {
  return JSON.parse(stderr) as { error: string; code: string }
}

describe("search flag validation", () => {
  test("requires at least one filter so the CLI never dumps the whole feed", async () => {
    const result = await runCLI(["search"])
    expect(result.exitCode).toBe(1)
    expect(errorOf(result.stderr).code).toBe("MISSING_REQUIRED")
  })

  test("rejects an unknown province code", async () => {
    const result = await runCLI(["search", "--term", "analyst", "--province", "XX"])
    expect(result.exitCode).toBe(1)
    const err = errorOf(result.stderr)
    expect(err.code).toBe("INVALID_ARGUMENT")
    expect(err.error).toMatch(/Invalid province/)
  })

  test("rejects a --filter without an equals sign", async () => {
    const result = await runCLI(["search", "--term", "analyst", "--filter", "fage"])
    expect(result.exitCode).toBe(1)
    expect(errorOf(result.stderr).code).toBe("INVALID_ARGUMENT")
  })

  test("rejects a --filter with an empty key", async () => {
    const result = await runCLI(["search", "--term", "analyst", "--filter", "=2"])
    expect(result.exitCode).toBe(1)
    expect(errorOf(result.stderr).code).toBe("INVALID_ARGUMENT")
  })
})

describe("detail flag validation", () => {
  test("requires a posting id", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).toBe(1)
    expect(errorOf(result.stderr).code).toBe("MISSING_REQUIRED")
  })

  test("rejects a non-numeric posting id before making a request", async () => {
    const result = await runCLI(["detail", "not-an-id"])
    expect(result.exitCode).toBe(1)
    expect(errorOf(result.stderr).code).toBe("INVALID_ARGUMENT")
  })
})

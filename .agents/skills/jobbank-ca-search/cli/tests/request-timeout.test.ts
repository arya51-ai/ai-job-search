import { afterEach, describe, expect, test } from "bun:test"
import { fetchResultCount, fetchWithUA } from "../src/helpers"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("fetchWithUA", () => {
  test("applies a request timeout signal", async () => {
    let sawSignal = false
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      sawSignal = init?.signal instanceof AbortSignal
      return new Response("ok")
    }) as unknown as typeof fetch

    await fetchWithUA("https://example.com")
    expect(sawSignal).toBe(true)
  })

  test("retries on 429 and returns the eventual success", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return calls < 3 ? new Response("slow down", { status: 429 }) : new Response("ok")
    }) as unknown as typeof fetch

    const response = await fetchWithUA("https://example.com")
    expect(response.status).toBe(200)
    expect(calls).toBe(3)
  })

  test("retries on 5xx", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return calls < 2 ? new Response("boom", { status: 503 }) : new Response("ok")
    }) as unknown as typeof fetch

    expect((await fetchWithUA("https://example.com")).status).toBe(200)
    expect(calls).toBe(2)
  })

  test("does not retry a 4xx that is not 429", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response("nope", { status: 404 })
    }) as unknown as typeof fetch

    expect((await fetchWithUA("https://example.com")).status).toBe(404)
    expect(calls).toBe(1)
  })
})

describe("fetchResultCount", () => {
  test("parses a comma-grouped count", async () => {
    globalThis.fetch = (async () =>
      new Response('<span class="found" id="results-count">2,076</span>')) as unknown as typeof fetch
    expect(await fetchResultCount("analyst", "Toronto")).toBe(2076)
  })

  test("returns null when the count is a template placeholder", async () => {
    globalThis.fetch = (async () =>
      new Response('<span class="found" id="results-count">{0}</span>')) as unknown as typeof fetch
    expect(await fetchResultCount("analyst", "Toronto")).toBeNull()
  })

  test("returns null rather than throwing when the count request fails", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch
    expect(await fetchResultCount("analyst", "Toronto")).toBeNull()
  })
})

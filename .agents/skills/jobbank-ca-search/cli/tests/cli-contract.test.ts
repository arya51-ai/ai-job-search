import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers"

/**
 * End-to-end contract tests. The CLI is spawned as a real process pointed at a
 * local stub of Job Bank via JOBBANK_CA_BASE_URL, so these assert the actual
 * outbound query string the command builds.
 */

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <title><![CDATA[stub - Job Bank]]></title>
  <entry>
    <title type="html"><![CDATA[business analyst]]></title>
    <link rel="alternate" type="text/html" href="https://www.jobbank.gc.ca/jobsearch/jobposting/111"/>
    <id>https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=900001</id>
    <updated>__RECENT__</updated>
    <summary type="html"><![CDATA[<strong>Job number:</strong> 900001<br /><strong>Location:</strong> Toronto (ON)<br /><strong>Employer:</strong> Acme Inc<br /><strong>Salary:</strong> $80,000.00 annually]]></summary>
  </entry>
  <entry>
    <title type="html"><![CDATA[welder]]></title>
    <link rel="alternate" type="text/html" href="https://www.jobbank.gc.ca/jobsearch/jobposting/222"/>
    <id>https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=900002</id>
    <updated>2020-01-01T00:00:00Z</updated>
    <summary type="html"><![CDATA[<strong>Job number:</strong> 900002<br /><strong>Location:</strong> Sudbury (ON)<br /><strong>Employer:</strong> Northern Steel<br /><strong>Salary:</strong> $32.00 hourly]]></summary>
  </entry>
</feed>`

const POSTING = `<html><head><title>business analyst - Toronto, ON - Job posting - Job Bank</title></head>
<body><span property="title">business analyst</span>
<span property="datePosted">Posted on July 25, 2026</span>
<p class="date-business"><span property="hiringOrganization">Acme Inc</span></p>
<p property="validThrough">2026-09-01</p></body></html>`

let server: ReturnType<typeof Bun.serve>
let base: string
const feedRequests: string[] = []

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/jobsearch/feed/jobSearchRSSfeed") {
        feedRequests.push(url.search)
        return new Response(FEED.replace("__RECENT__", new Date().toISOString()), {
          headers: { "content-type": "application/atom+xml" },
        })
      }
      if (url.pathname === "/jobsearch/jobsearch") {
        return new Response('<span class="found" id="results-count">2,076</span>', {
          headers: { "content-type": "text/html" },
        })
      }
      if (url.pathname.startsWith("/jobsearch/jobposting/")) {
        if (url.pathname.endsWith("/999")) return new Response("gone", { status: 404 })
        return new Response(POSTING, { headers: { "content-type": "text/html" } })
      }
      return new Response("not found", { status: 404 })
    },
  })
  base = `http://localhost:${server.port}`
})

afterAll(() => server.stop(true))

function env() {
  return { JOBBANK_CA_BASE_URL: base }
}

describe("search query construction", () => {
  test("sends the keyword as searchstring, never as term", async () => {
    feedRequests.length = 0
    await runCLI(["search", "--term", "analyst", "--province", "ON"], env())
    const params = new URLSearchParams(feedRequests[0])

    // Regression guard: Job Bank accepts `term` but only uses it to rewrite the
    // feed <title>; entries come back completely unfiltered. Sending `term`
    // instead of `searchstring` silently returns every recent posting.
    expect(params.get("searchstring")).toBe("analyst")
    expect(params.get("term")).toBeNull()
  })

  test("uppercases the province and sends it as fprov", async () => {
    feedRequests.length = 0
    await runCLI(["search", "--term", "analyst", "--province", "on"], env())
    expect(new URLSearchParams(feedRequests[0]).get("fprov")).toBe("ON")
  })

  test("does not send city to the server, since the feed ignores location", async () => {
    feedRequests.length = 0
    await runCLI(["search", "--term", "analyst", "--city", "Toronto"], env())
    const params = new URLSearchParams(feedRequests[0])
    expect(params.get("locationstring")).toBeNull()
    expect(params.get("city")).toBeNull()
  })

  test("passes comma-separated --filter pairs through, repeating duplicate keys", async () => {
    feedRequests.length = 0
    await runCLI(["search", "--term", "x", "--filter", "fage=2,fn21=21220,fn21=21221"], env())
    const params = new URLSearchParams(feedRequests[0])
    expect(params.get("fage")).toBe("2")
    expect(params.getAll("fn21")).toEqual(["21220", "21221"])
  })

  test("keeps only the last occurrence when --filter is repeated, as the flag parser dictates", async () => {
    // Documents a real bunli limitation: repeated flags collapse to the last
    // value. The upstream Danish skills advertise "Repeatable: --type 3 --type 6",
    // which does not actually work — comma-separation is the working mechanism.
    feedRequests.length = 0
    await runCLI(["search", "--term", "x", "--filter", "fage=2", "--filter", "fage=3"], env())
    expect(new URLSearchParams(feedRequests[0]).get("fage")).toBe("3")
  })
})

describe("search output", () => {
  test("normalizes entries and reports meta", async () => {
    const out = parseJSON<{ meta: Record<string, unknown>; results: Array<Record<string, unknown>> }>(
      await runCLI(["search", "--term", "analyst", "--province", "ON"], env())
    )
    expect(out.meta.total).toBe(2076)
    expect(out.results).toHaveLength(2)
    expect(out.results[0]).toMatchObject({
      id: "111",
      jobNumber: "900001",
      title: "business analyst",
      employer: "Acme Inc",
      city: "Toronto",
      province: "ON",
    })
  })

  test("--city filters client-side and flags it in meta", async () => {
    const out = parseJSON<{ meta: Record<string, unknown>; results: Array<{ city: string }> }>(
      await runCLI(["search", "--term", "analyst", "--city", "Toronto"], env())
    )
    expect(out.results).toHaveLength(1)
    expect(out.results[0].city).toBe("Toronto")
    expect(out.meta.clientFiltered).toBe(true)
    expect(out.meta.matchedInFeed).toBe(1)
  })

  test("--since-days drops stale postings", async () => {
    const out = parseJSON<{ results: Array<{ title: string }> }>(
      await runCLI(["search", "--term", "analyst", "--since-days", "7"], env())
    )
    expect(out.results.map((r) => r.title)).toEqual(["business analyst"])
  })

  test("--limit caps output without changing matchedInFeed", async () => {
    const out = parseJSON<{ meta: Record<string, unknown>; results: unknown[] }>(
      await runCLI(["search", "--term", "analyst", "--limit", "1"], env())
    )
    expect(out.results).toHaveLength(1)
    expect(out.meta.matchedInFeed).toBe(2)
  })
})

describe("detail", () => {
  test("fetches and parses a posting", async () => {
    const out = parseJSON<Record<string, unknown>>(await runCLI(["detail", "111"], env()))
    expect(out).toMatchObject({ id: "111", title: "business analyst", employer: "Acme Inc", validThrough: "2026-09-01" })
  })

  test("reports NOT_FOUND for a missing posting", async () => {
    const result = await runCLI(["detail", "999"], env())
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "NOT_FOUND" })
  })
})

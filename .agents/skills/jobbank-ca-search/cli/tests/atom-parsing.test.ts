import { afterEach, describe, expect, test } from "bun:test"
import {
  USER_AGENT,
  decodeXmlEntities,
  extractPostingId,
  feedFetch,
  parseAtomEntries,
  parseAtomSummary,
} from "../src/helpers"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <title><![CDATA[analyst - Job Bank]]></title>
  <entry>
    <title type="html"><![CDATA[informatics security analyst]]></title>
    <link rel="alternate" type="text/html" href="https://www.jobbank.gc.ca/jobsearch/jobposting/49954836"/>
    <id>https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=3631008</id>
    <updated>2026-07-25T19:59:00Z</updated>
    <summary type="html"><![CDATA[<strong>Job number:</strong> 3631008<br /><strong>Location:</strong> Toronto (ON)  <br /><strong>Employer:</strong> Bell Canada<br /><strong>Salary:</strong> $30.00 to $72.12 hourly]]></summary>
  </entry>
  <entry>
    <title type="html"><![CDATA[caf&#233; supervisor]]></title>
    <link rel="alternate" type="text/html" href="https://www.jobbank.gc.ca/jobsearch/jobposting/49954999"/>
    <id>https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=3631009</id>
    <updated>2026-07-20T10:00:00Z</updated>
    <summary type="html"><![CDATA[<strong>Job number:</strong> 3631009<br /><strong>Location:</strong> Various locations<br /><strong>Employer:</strong> Tim &amp; Co<br /><strong>Salary:</strong> $18.00 hourly]]></summary>
  </entry>
</feed>`

describe("parseAtomEntries", () => {
  test("parses Atom <entry> elements, not RSS <item>", () => {
    const entries = parseAtomEntries(SAMPLE_FEED)
    expect(entries).toHaveLength(2)
    expect(entries[0].title).toBe("informatics security analyst")
    expect(entries[0].link).toBe("https://www.jobbank.gc.ca/jobsearch/jobposting/49954836")
    expect(entries[0].updated).toBe("2026-07-25T19:59:00Z")
  })

  test("prefers rel=alternate for the posting link", () => {
    const xml = `<feed><entry>
      <link rel="self" href="https://example.com/self"/>
      <link rel="alternate" type="text/html" href="https://www.jobbank.gc.ca/jobsearch/jobposting/1234"/>
    </entry></feed>`
    expect(parseAtomEntries(xml)[0].link).toBe("https://www.jobbank.gc.ca/jobsearch/jobposting/1234")
  })

  test("decodes XML entities in titles and summaries", () => {
    const entries = parseAtomEntries(SAMPLE_FEED)
    expect(entries[1].title).toBe("café supervisor")
    expect(parseAtomSummary(entries[1].summary).employer).toBe("Tim & Co")
  })

  test("returns an empty array for a feed with no entries", () => {
    expect(parseAtomEntries('<?xml version="1.0"?><feed></feed>')).toEqual([])
  })
})

describe("parseAtomSummary", () => {
  test("extracts every labelled field", () => {
    const entries = parseAtomEntries(SAMPLE_FEED)
    expect(parseAtomSummary(entries[0].summary)).toEqual({
      jobNumber: "3631008",
      location: "Toronto (ON)",
      city: "Toronto",
      province: "ON",
      employer: "Bell Canada",
      salary: "$30.00 to $72.12 hourly",
    })
  })

  test("leaves province blank when the location has no province code", () => {
    const parsed = parseAtomSummary(parseAtomEntries(SAMPLE_FEED)[1].summary)
    expect(parsed.city).toBe("Various locations")
    expect(parsed.province).toBe("")
  })

  test("returns blank fields rather than throwing on an unparseable summary", () => {
    const parsed = parseAtomSummary("no labelled fields here")
    expect(parsed.employer).toBe("")
    expect(parsed.jobNumber).toBe("")
  })
})

describe("extractPostingId", () => {
  test("pulls the posting id out of a job URL", () => {
    expect(extractPostingId("https://www.jobbank.gc.ca/jobsearch/jobposting/49954836")).toBe("49954836")
  })

  test("returns an empty string when the URL has no posting id", () => {
    expect(extractPostingId("https://www.jobbank.gc.ca/jobsearch/jobsearch")).toBe("")
  })
})

describe("decodeXmlEntities", () => {
  test("decodes &amp; last so double-encoding is not mangled", () => {
    expect(decodeXmlEntities("A &amp;lt; B")).toBe("A &lt; B")
  })
})

describe("feedFetch", () => {
  test("hits the Atom feed path, serializes repeated params, and sends the UA", async () => {
    let requestedUrl = ""
    let requestedUserAgent = ""
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requestedUrl = String(input)
      requestedUserAgent = new Headers(init?.headers).get("User-Agent") ?? ""
      return new Response(SAMPLE_FEED)
    }) as unknown as typeof fetch

    const entries = await feedFetch({ searchstring: "analyst", fprov: "ON", fn21: ["21220", "21221"] })
    const url = new URL(requestedUrl)

    expect(url.pathname).toBe("/jobsearch/feed/jobSearchRSSfeed")
    expect(url.searchParams.get("searchstring")).toBe("analyst")
    expect(url.searchParams.get("fprov")).toBe("ON")
    expect(url.searchParams.getAll("fn21")).toEqual(["21220", "21221"])
    expect(requestedUserAgent).toBe(USER_AGENT)
    expect(entries).toHaveLength(2)
  })

  test("surfaces a clear message when bot protection blocks the feed", async () => {
    globalThis.fetch = (async () =>
      new Response("<html>Just a moment... cf-chl</html>", { status: 403 })) as unknown as typeof fetch

    await expect(feedFetch({ searchstring: "analyst" })).rejects.toThrow(/bot protection/i)
  })

  test("throws on a non-OK response", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch
    await expect(feedFetch({ searchstring: "analyst" })).rejects.toThrow(/404/)
  })
})

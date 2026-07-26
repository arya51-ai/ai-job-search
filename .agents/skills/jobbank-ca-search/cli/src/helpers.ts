import { parse as parseHtml } from "node-html-parser"

/**
 * Job Bank origin. Overridable via JOBBANK_CA_BASE_URL so the CLI contract
 * tests can point the whole command at a local stub server; leave it unset
 * in normal use.
 */
export const BASE_URL = process.env.JOBBANK_CA_BASE_URL ?? "https://www.jobbank.gc.ca"
export const FEED_PATH = "/jobsearch/feed/jobSearchRSSfeed"
export const SEARCH_PATH = "/jobsearch/jobsearch"
export const POSTING_PATH = "/jobsearch/jobposting"

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/** Canada Post province and territory codes, as used by Job Bank's `fprov` filter. */
export const PROVINCES = [
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
] as const

export type Province = (typeof PROVINCES)[number]

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export async function fetchWithUA(url: string): Promise<Response> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((resolve) => setTimeout(resolve, delay + jitter))
      delay = Math.min(delay * 2, 5000)
      continue
    }
    return response
  }
  throw new Error("Request failed after max retries")
}

export function buildQuery(params: Record<string, string | string[]>): URLSearchParams {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) searchParams.append(key, v)
    } else {
      searchParams.append(key, value)
    }
  }
  return searchParams
}

/* ------------------------------------------------------------------ *
 * Atom feed
 *
 * Job Bank serves Atom 1.0 (<entry>), not RSS 2.0 (<item>). Entry shape:
 *
 *   <entry>
 *     <title type="html"><![CDATA[home support worker]]></title>
 *     <link rel="alternate" type="text/html"
 *           href="https://www.jobbank.gc.ca/jobsearch/jobposting/49960986"/>
 *     <id>https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=3631008</id>
 *     <updated>2026-07-25T19:59:00Z</updated>
 *     <summary type="html"><![CDATA[
 *       <strong>Job number:</strong> 3631008<br />
 *       <strong>Location:</strong> Brampton (ON)<br />
 *       <strong>Employer:</strong> Some Employer<br />
 *       <strong>Salary:</strong> $20.00 hourly ]]></summary>
 *   </entry>
 * ------------------------------------------------------------------ */

export interface AtomEntry {
  title: string
  link: string
  id: string
  updated: string
  summary: string
}

function extractTagText(xml: string, tag: string): string {
  const cdata = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`))
  if (cdata) return cdata[1].trim()
  const plain = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  return plain ? plain[1].trim() : ""
}

function extractAlternateLink(xml: string): string {
  // Prefer rel="alternate"; fall back to the first <link href="...">.
  const alt = xml.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)
  if (alt) return decodeXmlEntities(alt[1])
  const any = xml.match(/<link[^>]*href="([^"]+)"/)
  return any ? decodeXmlEntities(any[1]) : ""
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

export function parseAtomEntries(xml: string): AtomEntry[] {
  const entries: AtomEntry[] = []
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entryXml = match[1]
    entries.push({
      title: decodeXmlEntities(extractTagText(entryXml, "title")),
      link: extractAlternateLink(entryXml),
      id: extractTagText(entryXml, "id"),
      updated: extractTagText(entryXml, "updated"),
      summary: decodeXmlEntities(extractTagText(entryXml, "summary")),
    })
  }
  return entries
}

export interface ParsedSummary {
  jobNumber: string
  location: string
  city: string
  province: string
  employer: string
  salary: string
}

function summaryField(summary: string, label: string): string {
  // Fields are "<strong>Label:</strong> value" separated by <br />.
  const re = new RegExp(`<strong>\\s*${label}\\s*:\\s*</strong>\\s*([\\s\\S]*?)(?:<br\\s*/?>|$)`, "i")
  const match = summary.match(re)
  if (!match) return ""
  return match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

export function parseAtomSummary(summary: string): ParsedSummary {
  const location = summaryField(summary, "Location")
  // Location renders as "Brampton (ON)" — split the trailing province code out.
  const locMatch = location.match(/^(.*?)\s*\(([A-Z]{2})\)\s*$/)
  return {
    jobNumber: summaryField(summary, "Job number"),
    location,
    city: locMatch ? locMatch[1].trim() : location,
    province: locMatch ? locMatch[2] : "",
    employer: summaryField(summary, "Employer"),
    salary: summaryField(summary, "Salary"),
  }
}

/** Posting id from a job URL: .../jobsearch/jobposting/49960986 -> "49960986". */
export function extractPostingId(url: string): string {
  const match = url.match(/\/jobposting\/(\d+)/)
  return match ? match[1] : ""
}

export async function feedFetch(params: Record<string, string | string[]>): Promise<AtomEntry[]> {
  const url = `${BASE_URL}${FEED_PATH}?${buildQuery(params).toString()}`
  const response = await fetchWithUA(url)
  if (!response.ok) {
    const body = await response.clone().text()
    if (response.status === 403 && /just a moment|cloudflare|cf-chl/i.test(body)) {
      throw new Error(
        "Job Bank is blocking automated requests with bot protection. Skip this portal or use the WebSearch fallback."
      )
    }
    throw new Error(`Failed to fetch Atom feed: ${response.status} ${response.statusText}`)
  }
  return parseAtomEntries(await response.text())
}

/**
 * Total match count, scraped from the HTML search page.
 *
 * The Atom feed carries no total, so this mirrors what the upstream Danish
 * portals do: one extra polite request purely to populate `meta.total`.
 * Returns null on any failure — the count is a nicety, never load-bearing.
 */
export async function fetchResultCount(term: string, locationString: string): Promise<number | null> {
  try {
    const query = buildQuery({ searchstring: term, locationstring: locationString })
    const response = await fetchWithUA(`${BASE_URL}${SEARCH_PATH}?${query.toString()}`)
    if (!response.ok) return null
    const html = await response.text()
    const match = html.match(/id="results-count"[^>]*>\s*([\d,\s.]+)/)
    if (!match) return null
    const digits = match[1].replace(/[^\d]/g, "")
    if (!digits) return null
    return parseInt(digits, 10)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * Job posting detail
 *
 * Job Bank detail pages carry no JSON-LD. They use RDFa (`property="..."`)
 * over the schema.org JobPosting vocabulary, so everything below reads
 * those attributes. Every field is optional by design: Job Bank omits
 * whole sections depending on the posting, and a missing section must
 * degrade to null rather than fail the command.
 * ------------------------------------------------------------------ */

export interface JobPostingDetail {
  id: string
  url: string
  title: string
  employer: string
  datePosted: string
  validThrough: string | null
  location: { city: string; province: string; raw: string }
  salary: { min: string | null; max: string | null; currency: string | null; unit: string | null; raw: string }
  workHours: string | null
  sections: Record<string, string>
  description: string
}

function cleanText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

/**
 * Job Bank renders salary as adjacent RDFa spans with no whitespace between
 * them, so the concatenated text reads "$20.00HOUR hourly". Re-insert a space
 * before an ALL-CAPS unit run that is glued to the preceding value.
 */
function spaceGluedUnits(value: string): string {
  return value.replace(/([\d.,])([A-Z]{2,})/g, "$1 $2")
}

export function parseJobPostingRdfa(html: string, fallbackId: string, url: string): JobPostingDetail | null {
  const root = parseHtml(html)

  const title = cleanText(root.querySelector('[property="title"]')?.text)
  if (!title) return null

  // Site chrome also carries property="name"/"areaServed" (Government of Canada
  // header), so employer is read from the posting header block only.
  const employer = cleanText(
    root.querySelector('.date-business [property="hiringOrganization"]')?.text ??
      root.querySelector('[property="hiringOrganization"] [property="name"]')?.text ??
      root.querySelector(".date-business .business")?.text
  )

  const datePosted = cleanText(root.querySelector('[property="datePosted"]')?.text).replace(/^Posted on\s*/i, "")

  const validThroughRaw = cleanText(root.querySelector('[property="validThrough"]')?.text)
  const validThroughMatch = validThroughRaw.match(/\d{4}-\d{2}-\d{2}/)
  const validThrough = validThroughMatch ? validThroughMatch[0] : null

  // "<job title> - Brampton, ON - Job posting - Job Bank"
  const pageTitle = cleanText(root.querySelector("title")?.text)
  const locMatch = pageTitle.match(/-\s*([^-]+?),\s*([A-Z]{2})\s*-\s*Job posting/)
  const location = {
    city: locMatch ? locMatch[1].trim() : "",
    province: locMatch ? locMatch[2] : "",
    raw: locMatch ? `${locMatch[1].trim()} (${locMatch[2]})` : "",
  }

  const minValue = root.querySelector('[property="minValue"]')?.getAttribute("content") ?? null
  const maxValue = root.querySelector('[property="maxValue"]')?.getAttribute("content") ?? null
  const currency = root.querySelector('[property="currency"]')?.getAttribute("content") ?? null
  const unit =
    root.querySelector('[property="unitText"]')?.getAttribute("content") ??
    cleanText(root.querySelector('[property="unitText"]')?.text) ??
    null
  const salaryRaw = spaceGluedUnits(
    cleanText(root.querySelector('[property="baseSalary"]')?.text) || cleanText(root.querySelector(".job-property-value")?.text)
  )

  const workHours = cleanText(root.querySelector('[property="workHours"]')?.text) || null

  // Long-form content blocks, keyed by their RDFa property.
  const sections: Record<string, string> = {}
  for (const property of [
    "description",
    "responsibilities",
    "skills",
    "qualification",
    "educationRequirements",
    "experienceRequirements",
    "jobBenefits",
    "specialCommitments",
  ]) {
    const node = root.querySelector(`[property~="${property}"]`)
    const text = cleanText(node?.text)
    if (text) sections[property] = text
  }

  const description = sections.description ?? Object.values(sections).join("\n\n")

  return {
    id: fallbackId,
    url,
    title,
    employer,
    datePosted,
    validThrough,
    location,
    salary: { min: minValue, max: maxValue, currency, unit: unit || null, raw: salaryRaw },
    workHours,
    sections,
    description,
  }
}

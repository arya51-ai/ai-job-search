import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import {
  PROVINCES,
  extractPostingId,
  feedFetch,
  fetchResultCount,
  parseAtomSummary,
  writeError,
} from "../helpers.js"

interface SearchResult {
  id: string
  jobNumber: string
  title: string
  employer: string
  location: string
  city: string
  province: string
  salary: string
  posted: string
  url: string
}

export const search = defineCommand({
  name: "search",
  description: "Search Job Bank Canada listings via the national Atom feed",
  options: {
    term: option(z.string().optional(), {
      description: "Keyword search (title, employer, description)",
    }),
    province: option(z.string().optional(), {
      description: `Province/territory code, server-side filter. One of: ${PROVINCES.join(", ")}`,
    }),
    city: option(z.string().optional(), {
      description: 'City filter, applied client-side against the feed location (e.g. --city Toronto)',
    }),
    "since-days": option(z.coerce.number().int().min(1).optional(), {
      description: "Only postings updated within the last N days (client-side)",
    }),
    rows: option(z.coerce.number().int().min(1).max(100).default(100), {
      description: "Rows requested from the feed. A hint, not a guarantee — Job Bank may return more or fewer; use --limit for a hard cap.",
    }),
    sort: option(z.enum(["D", "M"]).default("D"), {
      description: "Sort order: D = date posted, M = best match",
    }),
    filter: option(z.union([z.string(), z.array(z.string())]).optional(), {
      description:
        'Raw Job Bank filters as comma-separated key=value pairs (e.g. --filter "fage=2,fn21=21220,fn21=21221"). ' +
        "Escape hatch for Job Bank's undocumented numeric filter codes. Note: the flag parser keeps only the " +
        "last occurrence of a repeated flag, so pass one comma-separated string rather than --filter twice.",
    }),
    limit: option(z.coerce.number().int().min(1).optional(), {
      description: "Cap total results returned by the CLI (client-side)",
    }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), {
      description: "Output format: json, table, plain",
    }),
  },
  handler: async ({ flags, signal }) => {
    if (signal.aborted) return

    if (!flags.term && !flags.province && !flags.city && !flags.filter) {
      writeError("At least one of --term, --province, --city or --filter is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    const province = flags.province?.toUpperCase()
    if (province && !(PROVINCES as readonly string[]).includes(province)) {
      writeError(`Invalid province "${flags.province}". Expected one of: ${PROVINCES.join(", ")}`, "INVALID_ARGUMENT")
      process.exit(1)
    }

    const params: Record<string, string | string[]> = {
      sort: flags.sort,
      rows: String(flags.rows),
    }
    // `searchstring` is the parameter that actually filters. Job Bank also
    // accepts `term`, but it only rewrites the feed's <title> — the entries
    // come back unfiltered, so sending `term` would silently return every
    // recent posting. Verified 2026-07-26: term=analyst, term=welder and no
    // term at all return byte-identical entry sets.
    if (flags.term) params["searchstring"] = flags.term
    // `fprov` is the only location filter the feed honours; `locationstring`
    // is accepted and ignored, which is why --city filters client-side below.
    if (province) params["fprov"] = province

    if (flags.filter) {
      const raw = (Array.isArray(flags.filter) ? flags.filter : [flags.filter]).flatMap((v) => v.split(","))
      for (const pair of raw) {
        if (!pair.trim()) continue
        const eq = pair.indexOf("=")
        if (eq <= 0) {
          writeError(`Invalid --filter "${pair}". Expected key=value.`, "INVALID_ARGUMENT")
          process.exit(1)
        }
        const key = pair.slice(0, eq)
        const value = pair.slice(eq + 1)
        const existing = params[key]
        if (existing === undefined) params[key] = value
        else if (Array.isArray(existing)) existing.push(value)
        else params[key] = [existing, value]
      }
    }

    try {
      const entries = await feedFetch(params)
      if (signal.aborted) return

      let results: SearchResult[] = entries.map((entry) => {
        const parsed = parseAtomSummary(entry.summary)
        return {
          id: extractPostingId(entry.link),
          jobNumber: parsed.jobNumber,
          title: entry.title,
          employer: parsed.employer,
          location: parsed.location,
          city: parsed.city,
          province: parsed.province,
          salary: parsed.salary,
          posted: entry.updated,
          url: entry.link,
        }
      })

      // Job Bank has no city-level feed parameter, so city narrowing happens here.
      if (flags.city) {
        const needle = flags.city.toLowerCase()
        results = results.filter((r) => r.city.toLowerCase().includes(needle) || r.location.toLowerCase().includes(needle))
      }

      if (flags["since-days"] !== undefined) {
        const cutoff = Date.now() - flags["since-days"] * 86_400_000
        results = results.filter((r) => {
          const t = Date.parse(r.posted)
          return Number.isNaN(t) ? true : t >= cutoff
        })
      }

      const matched = results.length
      if (flags.limit !== undefined) results = results.slice(0, flags.limit)

      // meta.total is Job Bank's server-side count for term+location. When a
      // client-side city or date filter ran, it will exceed `matched`.
      const total = await fetchResultCount(flags.term ?? "", flags.city ?? province ?? "")

      const output = {
        meta: {
          total,
          returned: results.length,
          matchedInFeed: matched,
          feedRows: flags.rows,
          clientFiltered: Boolean(flags.city || flags["since-days"] !== undefined),
        },
        results,
      }

      if (flags.format === "json") {
        console.log(JSON.stringify(output, null, 2))
      } else if (flags.format === "table") {
        outputTable(results)
      } else {
        outputPlain(results)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Distinct code so /scrape can skip the portal for this run rather than
      // treating an outage as a genuine zero-result search.
      const code = /maintenance window|non-Atom response|bot protection/i.test(message)
        ? "PORTAL_UNAVAILABLE"
        : "API_ERROR"
      writeError(message, code)
      process.exit(1)
    }
  },
})

function outputTable(results: SearchResult[]): void {
  console.log("id         title                                employer               location            salary")
  for (const r of results) {
    const id = String(r.id || "-").padEnd(10)
    const title = String(r.title || "-").substring(0, 36).padEnd(36)
    const employer = String(r.employer || "-").substring(0, 22).padEnd(22)
    const location = String(r.location || "-").substring(0, 19).padEnd(19)
    console.log(`${id} ${title} ${employer} ${location} ${r.salary || "-"}`)
  }
}

function outputPlain(results: SearchResult[]): void {
  for (const r of results) {
    console.log(`id: ${r.id}`)
    console.log(`jobNumber: ${r.jobNumber}`)
    console.log(`title: ${r.title}`)
    console.log(`employer: ${r.employer}`)
    console.log(`location: ${r.location}`)
    console.log(`salary: ${r.salary}`)
    console.log(`posted: ${r.posted}`)
    console.log(`url: ${r.url}`)
    console.log("")
  }
}

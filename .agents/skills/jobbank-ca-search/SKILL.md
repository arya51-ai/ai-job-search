---
name: jobbank-ca-search
version: 1.0.0
description: >
  Make sure to use this skill whenever the user mentions anything related to job
  searching in Canada — Job Bank, jobbank.gc.ca, Guichet-Emplois, or looking for
  work in any Canadian province, territory, or city, even if they don't mention
  Job Bank explicitly. Also invoke this skill for questions about Canadian job
  listings, NOC codes, wages in Canada, or openings in specific Canadian
  industries or regions. Trigger phrases include:
  job bank, jobbank, jobbank.gc.ca, guichet emplois, jobs canada, canadian jobs,
  find job canada, job search canada, jobs toronto, jobs ontario, jobs vancouver,
  jobs montreal, jobs calgary, jobs ottawa, jobs edmonton, jobs winnipeg,
  jobs halifax, jobs mississauga, jobs brampton, jobs sudbury, jobs GTA,
  ontario jobs, british columbia jobs, alberta jobs, quebec jobs, remote job canada,
  government of canada jobs, NOC code, national occupational classification,
  hourly wage canada, salary canada, newcomer jobs canada, jobs for new immigrants,
  skilled trades canada, healthcare jobs canada, tech jobs canada, finance jobs toronto,
  administrative jobs, analyst jobs canada, entry level jobs canada.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/jobbank-ca-search/cli/src/cli.ts *)
---

# Job Bank Canada Search Skill

Search live Canadian job listings from [Job Bank](https://www.jobbank.gc.ca), the
Government of Canada's national job board. Job Bank is the broadest single source
of Canadian postings — it aggregates employer submissions and provincial feeds
across every province and territory, and it is not behind bot protection.

Search uses Job Bank's **Atom** feed; detail uses **RDFa** parsing of the posting
page. Neither is a documented public API, so both are treated as best-effort and
degrade gracefully rather than failing hard.

## When to use this skill

Invoke this skill when the user wants to:

- Search for jobs, positions, or career opportunities anywhere in Canada
- Find work in a specific Canadian province, territory, or city
- Look for jobs by keyword, employer, wage, or posting age
- Get full details for a specific Job Bank posting
- Check what a Canadian role typically pays (postings carry the wage inline)

## Commands

### Search jobs

```bash
bun run .agents/skills/jobbank-ca-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--term <text>` — keyword search (title, employer, description)
- `--province <code>` — server-side province/territory filter: `AB`, `BC`, `MB`, `NB`, `NL`, `NS`, `NT`, `NU`, `ON`, `PE`, `QC`, `SK`, `YT`
- `--city <name>` — city filter, applied client-side (see caveat below)
- `--since-days <n>` — only postings updated within the last N days
- `--sort D|M` — `D` = date posted (default), `M` = best match
- `--rows <n>` — rows requested from the feed (hint only; use `--limit` for a hard cap)
- `--filter "k=v,k=v"` — raw Job Bank filter codes, comma-separated
- `--limit <n>` — cap results returned by the CLI
- `--format json|table|plain`

### Full job detail

```bash
bun run .agents/skills/jobbank-ca-search/cli/src/cli.ts detail <id> [--format json|plain]
```

`id` is the numeric posting id from `search` results (the number in
`/jobsearch/jobposting/<id>`), **not** the `jobNumber` field.

## Portal quirks that matter

These are verified behaviours, not guesses. Read them before changing the CLI.

1. **`term` is a decoy.** Job Bank's feed accepts a `term` parameter and uses it
   to rewrite the feed's `<title>`, but it does **not** filter the entries.
   `term=analyst`, `term=welder` and no term at all return identical entry sets.
   The parameter that actually filters is `searchstring`. The CLI sends
   `searchstring`; a regression test in `cli/tests/cli-contract.test.ts` locks
   this in. Never "simplify" it back to `term`.

2. **The feed ignores location strings.** `locationstring` is accepted and
   discarded by the feed. Only `fprov` (province) filters server-side, which is
   why `--city` filters client-side after fetching. Consequence: always pair
   `--city` with `--province`, or the city filter runs against a national result
   set and will look strangely empty.

3. **`rows` is a hint.** Requesting `rows=25` has been observed returning 75
   entries. Use `--limit` when you need a hard cap.

4. **No pagination.** One feed request is all you get. `meta.total` reports Job
   Bank's own server-side count for the term, which will usually exceed what the
   feed returns. `meta.matchedInFeed` is how many survived client-side filters.

5. **Detail pages have no JSON-LD.** They use RDFa (`property="..."`) over the
   schema.org JobPosting vocabulary. The Government of Canada site chrome also
   carries `property="name"` and `property="areaServed"`, so employer and
   location are read from scoped selectors, not the first match on the page.

6. **Nightly maintenance window.** Job Bank goes down for system maintenance
   roughly 12:00–7:00 a.m. Eastern and answers with **HTTP 200 plus an HTML
   outage notice**, not an error status. Parsed as Atom that yields zero
   entries, which looks exactly like "nothing matched". The CLI detects a
   non-Atom body and exits with code `PORTAL_UNAVAILABLE` instead. If you see
   that code, retry after 7:00 a.m. ET — it is not a bug and not an empty market.

7. **Coverage is skewed.** Job Bank is strongest on trades, healthcare, service,
   administrative, and entry-to-mid roles. Senior professional and tech postings
   are better covered by `linkedin-search`. Some employers never post to Job Bank
   at all — notably federal agencies and Crown corporations that run their own
   recruitment portals. If a search for a specific employer returns nothing, that
   is evidence about the portal, not about whether they are hiring.

## Usage examples

### Analyst roles in Toronto

```bash
bun run .agents/skills/jobbank-ca-search/cli/src/cli.ts search \
  --term "analyst" --province ON --city Toronto --sort M --limit 20 --format table
```

### Everything posted in BC in the last two days

```bash
bun run .agents/skills/jobbank-ca-search/cli/src/cli.ts search \
  --province BC --since-days 2 --format json
```

### Full detail on one posting

```bash
bun run .agents/skills/jobbank-ca-search/cli/src/cli.ts detail 49954836 --format plain
```

## Output shape

`search` returns:

```json
{
  "meta": {
    "total": 2076,
    "returned": 20,
    "matchedInFeed": 34,
    "feedRows": 100,
    "clientFiltered": true
  },
  "results": [
    {
      "id": "49954836",
      "jobNumber": "3631008",
      "title": "informatics security analyst",
      "employer": "Bell Canada",
      "location": "Toronto (ON)",
      "city": "Toronto",
      "province": "ON",
      "salary": "$30.00 to $72.12 hourly",
      "posted": "2026-07-25T19:59:00Z",
      "url": "https://www.jobbank.gc.ca/jobsearch/jobposting/49954836"
    }
  ]
}
```

Errors go to stderr as `{"error": "...", "code": "..."}` with a non-zero exit.
Codes: `MISSING_REQUIRED`, `INVALID_ARGUMENT`, `NOT_FOUND`, `PARSE_ERROR`,
`PORTAL_UNAVAILABLE` (outage or maintenance window — skip the portal this run
and retry later), `API_ERROR`.

## Personal use only

This CLI makes ordinary public HTTP requests at human scale, with a browser
User-Agent, a 15s timeout, and exponential backoff on 429/5xx. Use it for your
own job search. Do not run it as a bulk scraper.

## Development

```bash
cd .agents/skills/jobbank-ca-search/cli
bun install
bun test          # 50 tests, no network required
bunx tsc --noEmit
```

Set `JOBBANK_CA_BASE_URL` to point the CLI at a stub server (the contract tests
do this). Leave it unset in normal use.

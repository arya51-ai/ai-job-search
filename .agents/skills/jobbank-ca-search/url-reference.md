# Job Bank Canada — URL reference

Origin: `https://www.jobbank.gc.ca` (French: Guichet-Emplois, same host, `/fr/` paths)

## Atom search feed

```
GET /jobsearch/feed/jobSearchRSSfeed?searchstring=<kw>&fprov=<PROV>&sort=D&rows=100
```

| Param | Effect | Notes |
|---|---|---|
| `searchstring` | **Filters** by keyword | The real keyword parameter |
| `term` | **Ignored for filtering** | Only rewrites the feed `<title>`. Verified 2026-07-26 |
| `fprov` | Filters by province | `AB BC MB NB NL NS NT NU ON PE QC SK YT` |
| `locationstring` | **Ignored by the feed** | Works on the HTML page, not the feed |
| `sort` | `D` = date, `M` = best match | |
| `rows` | Row hint | Not authoritative; observed returning more than requested |
| `fage` | Posting age code | Undocumented numeric code; pass via `--filter` |
| `fcid` | City id | Undocumented numeric id; no public lookup found |
| `fn21` | NOC 2021 code | Undocumented; pass via `--filter` |

Format is **Atom 1.0** (`<entry>`), not RSS 2.0 (`<item>`).

Entry shape:

```xml
<entry>
  <title type="html"><![CDATA[home support worker]]></title>
  <link rel="alternate" type="text/html"
        href="https://www.jobbank.gc.ca/jobsearch/jobposting/49960986"/>
  <id>https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=3631008</id>
  <updated>2026-07-25T19:59:00Z</updated>
  <summary type="html"><![CDATA[
    <strong>Job number:</strong> 3631008<br />
    <strong>Location:</strong> Brampton (ON)<br />
    <strong>Employer:</strong> Example Employer<br />
    <strong>Salary:</strong> $20.00 hourly ]]></summary>
</entry>
```

Note the two distinct identifiers: the URL carries the **posting id** (used by
`detail`), while the summary carries Job Bank's **job number**.

## HTML search page (used only for the result count)

```
GET /jobsearch/jobsearch?searchstring=<kw>&locationstring=<city>
```

Total matches: `<span class="found" id="results-count">2,076</span>`.
The template also emits a literal `{0}` placeholder in unrendered copies, so a
non-numeric value must be treated as "unknown", not zero.

## Job posting detail

```
GET /jobsearch/jobposting/<postingId>
```

**No JSON-LD.** Structured data is RDFa over schema.org JobPosting:

| Selector | Field |
|---|---|
| `[property="title"]` | Job title |
| `[property="datePosted"]` | "Posted on July 25, 2026" |
| `[property="validThrough"]` | Expiry, contains `YYYY-MM-DD` |
| `[property="hiringOrganization"]` | Employer (scope to `.date-business`) |
| `[property="minValue"] / [property="maxValue"]` | Wage, in the `content` attribute |
| `[property="currency"]` | `CAD`, in `content` |
| `[property="unitText"]` | `HOUR` / `YEAR`, in `content` |
| `[property="workHours"]` | e.g. "30 hours per week" |
| `[property~="responsibilities"]` etc. | Long-form sections |

Caveats:
- Site chrome also carries `property="name"` and `property="areaServed"` (Government of Canada header) — never take the first match on the page.
- Education is `property="educationRequirements qualification"` — a space-separated token list, so match with `[property~="..."]`.
- Adjacent salary spans concatenate without whitespace (`$20.00HOUR`).
- City/province are most reliably read from `<title>`: `"<role> - Brampton, ON - Job posting - Job Bank"`.

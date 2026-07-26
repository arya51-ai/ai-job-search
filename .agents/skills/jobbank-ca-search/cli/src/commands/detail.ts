import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { BASE_URL, POSTING_PATH, fetchWithUA, parseJobPostingRdfa, writeError } from "../helpers.js"

export const detail = defineCommand({
  name: "detail",
  description: "Full detail for a single Job Bank posting, by posting id",
  options: {
    format: option(z.enum(["json", "plain"]).default("json"), {
      description: "Output format: json, plain",
    }),
  },
  handler: async ({ positional, flags, signal }) => {
    if (signal.aborted) return

    const id = positional[0]
    if (!id) {
      writeError("Posting id is required (e.g. detail 49960986)", "MISSING_REQUIRED")
      process.exit(1)
    }
    if (!/^\d+$/.test(id)) {
      writeError(`Invalid posting id "${id}". Expected digits only.`, "INVALID_ARGUMENT")
      process.exit(1)
    }

    const url = `${BASE_URL}${POSTING_PATH}/${id}`

    try {
      const response = await fetchWithUA(url)

      if (response.status === 404) {
        writeError("Job not found", "NOT_FOUND")
        process.exit(1)
      }
      if (!response.ok) {
        writeError(`Failed to fetch job page: ${response.status} ${response.statusText}`, "API_ERROR")
        process.exit(1)
      }

      const html = await response.text()
      if (signal.aborted) return

      const posting = parseJobPostingRdfa(html, id, url)
      if (!posting) {
        writeError(
          "No JobPosting RDFa found on the page. The posting may have expired, or Job Bank changed its markup.",
          "PARSE_ERROR"
        )
        process.exit(1)
      }

      if (flags.format === "json") {
        console.log(JSON.stringify(posting, null, 2))
      } else {
        outputPlain(posting)
      }
    } catch (err) {
      writeError(err instanceof Error ? err.message : String(err), "API_ERROR")
      process.exit(1)
    }
  },
})

function outputPlain(data: ReturnType<typeof parseJobPostingRdfa> & object): void {
  if (!data) return
  console.log(`id: ${data.id}`)
  console.log(`title: ${data.title}`)
  console.log(`employer: ${data.employer || "-"}`)
  console.log(`location: ${data.location.raw || "-"}`)
  console.log(`datePosted: ${data.datePosted || "-"}`)
  console.log(`validThrough: ${data.validThrough ?? "none"}`)
  const { min, max, currency, unit, raw } = data.salary
  const salary = min ? `${min}${max && max !== min ? `-${max}` : ""} ${currency ?? ""} ${unit ?? ""}`.trim() : raw || "-"
  console.log(`salary: ${salary}`)
  console.log(`workHours: ${data.workHours ?? "-"}`)
  console.log(`url: ${data.url}`)
  console.log("")
  for (const [key, value] of Object.entries(data.sections)) {
    console.log(`## ${key}`)
    console.log(value)
    console.log("")
  }
}

import { describe, expect, test } from "bun:test"
import { parseJobPostingRdfa } from "../src/helpers"

/**
 * Mirrors the real markup at jobbank.gc.ca/jobsearch/jobposting/<id> as of
 * 2026-07-26: RDFa `property=` attributes over schema.org JobPosting, no
 * JSON-LD anywhere on the page, and Government of Canada site chrome that
 * also carries property="name" / property="areaServed".
 */
const FIXTURE = `<!DOCTYPE html><html><head>
<title>home support worker - Brampton, ON - Job posting - Job Bank</title>
</head><body>
  <header>
    <span property="name">Government of Canada / <span lang="fr">Gouvernement du Canada</span></span>
    <meta property="areaServed" typeof="Country" content="Canada" />
  </header>
  <h1><span property="title">home support worker</span></h1>
  <p class="date-business">
    <span property="datePosted" class="date">Posted on July 25, 2026</span>
    <span> by </span>
    <span property="hiringOrganization">Maryhazel/John Buenaventura</span>
  </p>
  <p property="validThrough">2026-08-08 <span id="tp_expiryDate" class="timepickler"></span></p>
  <span property="baseSalary"><span property="currency" content="CAD" class="hidden">$</span><span property="minValue" content="20.00">20.00</span><span property="unitText" content="HOUR">HOUR</span> hourly</span>
  <span property='workHours'>30 hours per week</span>
  <div property="responsibilities"><h3>Responsibilities</h3><ul class="csvlist"><li><span>Assist clients in water</span></li></ul></div>
  <div property="skills"><h3>Additional information</h3><h4>Security and safety</h4><ul><li><span>Criminal record check</span></li></ul></div>
  <ul property="educationRequirements qualification"><li><span>Secondary (high) school graduation certificate</span></li></ul>
  <div property="experienceRequirements">1 to less than 7 months</div>
</body></html>`

describe("parseJobPostingRdfa", () => {
  const parsed = parseJobPostingRdfa(FIXTURE, "49960986", "https://www.jobbank.gc.ca/jobsearch/jobposting/49960986")

  test("parses the posting header", () => {
    expect(parsed).not.toBeNull()
    expect(parsed!.title).toBe("home support worker")
    expect(parsed!.employer).toBe("Maryhazel/John Buenaventura")
    expect(parsed!.datePosted).toBe("July 25, 2026")
  })

  test("does not mistake Government of Canada site chrome for the employer", () => {
    expect(parsed!.employer).not.toMatch(/Government of Canada/)
  })

  test("normalizes validThrough to a bare ISO date", () => {
    expect(parsed!.validThrough).toBe("2026-08-08")
  })

  test("reads location from the page title", () => {
    expect(parsed!.location).toEqual({ city: "Brampton", province: "ON", raw: "Brampton (ON)" })
  })

  test("reads salary from RDFa content attributes and un-glues the unit", () => {
    expect(parsed!.salary.min).toBe("20.00")
    expect(parsed!.salary.max).toBeNull()
    expect(parsed!.salary.currency).toBe("CAD")
    expect(parsed!.salary.unit).toBe("HOUR")
    expect(parsed!.salary.raw).toContain("20.00 HOUR")
  })

  test("captures work hours and the long-form sections", () => {
    expect(parsed!.workHours).toBe("30 hours per week")
    expect(Object.keys(parsed!.sections)).toEqual(
      expect.arrayContaining(["responsibilities", "skills", "educationRequirements", "experienceRequirements"])
    )
    expect(parsed!.sections.responsibilities).toContain("Assist clients in water")
  })

  test("matches space-separated property tokens", () => {
    // The education list is property="educationRequirements qualification".
    expect(parsed!.sections.qualification).toContain("Secondary (high) school")
  })

  test("returns null when the page carries no JobPosting RDFa", () => {
    expect(parseJobPostingRdfa("<html><body><p>Not a posting</p></body></html>", "1", "u")).toBeNull()
  })

  test("degrades to nulls instead of throwing on a sparse posting", () => {
    const sparse = `<html><head><title>cook - Job posting - Job Bank</title></head>
      <body><span property="title">cook</span></body></html>`
    const result = parseJobPostingRdfa(sparse, "2", "u")
    expect(result).not.toBeNull()
    expect(result!.title).toBe("cook")
    expect(result!.validThrough).toBeNull()
    expect(result!.workHours).toBeNull()
    expect(result!.salary.min).toBeNull()
    expect(result!.location.city).toBe("")
  })
})

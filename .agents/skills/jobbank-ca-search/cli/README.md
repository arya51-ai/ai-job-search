# jobbank-ca-cli

CLI for [Job Bank Canada](https://www.jobbank.gc.ca), the Government of Canada
national job board. Search via the Atom feed, detail via RDFa parsing.

```bash
bun install
bun run src/cli.ts search --term "analyst" --province ON --city Toronto --format table
bun run src/cli.ts detail 49954836
```

## Development

```bash
bun test          # 46 tests, fully offline
bunx tsc --noEmit
```

`JOBBANK_CA_BASE_URL` overrides the origin so the contract tests can point the
CLI at a local stub. Leave it unset in normal use.

See `../url-reference.md` for the endpoint contract and `../SKILL.md` for the
portal quirks — in particular that `searchstring`, not `term`, is what filters.

# RoleProof

RoleProof is a local-first, evidence-based job-fit analysis project for truthful technical
applications. Its goal is to compare real career evidence with job requirements without
inventing experience or presenting a fit score as an interview or hiring probability.

## Project Status

Phase 6 completes RoleProof's local automation surface on top of the deterministic CLI, local
Fastify server, browser workflow, SQLite history, optional providers, and bounded job URL source
analysis. RoleProof accepts plaintext, PDF, or DOCX resumes and pasted, piped, batched, or
URL-backed job descriptions, stores profiles and career evidence, retains analysis history, supports
full-text search, and renders schema-versioned JSON or Markdown. Optional evidence-constrained AI
enhancement is available in the CLI and browser only after explicit provider selection and consent.

The browser workflow supports pasted text or TXT/PDF/DOCX résumé uploads with deterministic
analysis, AI-enhanced analysis with deterministic fallback, provider/redaction settings, stored
analysis history with search and detail views, job URL fetching with source metadata, and
JSON/Markdown downloads. See [`ROLEPROOF_BUILD_SPEC.md`](./docs/ROLEPROOF_BUILD_SPEC.md) for the
phased product specification.

## Requirements

- Node.js 22, 23, or 24
- pnpm 10.24.0 through Corepack

```powershell
corepack enable
corepack prepare pnpm@10.24.0 --activate
pnpm install
```

## Development

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm test:cli
pnpm exec roleproof --help
pnpm exec roleproof --version
```

## Analyze

```powershell
pnpm exec roleproof analyze `
  --resume fixtures/phase-1/strong-match/resume.txt `
  --job fixtures/phase-1/strong-match/job.txt `
  --no-ai `
  --format json `
  --stdout
```

Analysis persists by default to `~/.roleproof/roleproof.db`. Use the global `--db
<absolute-sqlite-path>` option to select another database, or `--no-store` to avoid persistence.
Supported options include `--format markdown|json|both`, `--out`, `--stdout`, `--no-ai`,
`--no-store`, `--profile`, salary targets, location, and remote preference. PDF and DOCX input are
supported for resumes; job descriptions may be plaintext files or HTTP(S) URLs. URL fetching is
bounded by parser limits and records source metadata when analysis succeeds.

Job descriptions and résumés can also be piped as plaintext through stdin:

```powershell
Get-Content fixtures/phase-1/strong-match/job.txt -Raw | pnpm exec roleproof analyze `
  --resume fixtures/phase-1/strong-match/resume.txt `
  --stdin-job `
  --no-ai `
  --format json `
  --stdout
```

`--stdin-job` and `--stdin-resume` read plaintext only and cannot be combined with their file
counterparts (`--job`, `--resume`) or with each other. Piped input follows the same size and
encoding limits as plaintext files and produces identical analysis output.

AI is opt-in through an explicit `--provider` and `--model`; environment variables never select a
provider. Hosted and custom destinations also require `--confirm-transmission`. See
[`docs/provider-configuration.md`](./docs/provider-configuration.md) for OpenAI, Ollama, LM Studio,
redaction, limits, health checks, and credential configuration.

Without `--profile`, analysis uses evidence extracted from the supplied resume and stores it under
the default local profile. Pass an explicit `--profile <id>` to also analyze against all evidence
stored for that profile. Inferred evidence is confirmation-only, is classified
`requires-user-confirmation`, and contributes zero points.

Single formats write to stdout unless `--out` is provided. `--format both` writes
`roleproof-analysis.json` and `roleproof-analysis.md` to `--out`, or to the current directory when
`--out` is omitted. Both formats cannot share stdout because that would invalidate JSON output.

Exit code `3` identifies file or parsing errors. Exit code `4` means provider enhancement failed
and the deterministic fallback was returned. Exit code `10` means analysis succeeded but found an
explicit hard eligibility blocker. JSON output remains valid in both fallback and blocker cases.

## Batch analysis

`--manifest` analyzes many resume/job pairs from one JSON file. Paths resolve relative to the
manifest, and pairs run concurrently with a default of 4 simultaneous analyses:

```powershell
# batch.json
# { "schemaVersion": "1.0", "pairs": [{ "resume": "resumes/avery.txt", "job": "jobs/backend.txt" }] }
pnpm exec roleproof analyze --manifest batch.json --no-ai --format json --stdout
```

`--concurrency` overrides the worker count (1-8). Completed pairs are reported in manifest order
as `{ "status": "completed", "resumeDocumentId", "jobId", "analysis" }`; failed pairs are reported
in place as `{ "status": "failed", "code", "error" }` instead of aborting the batch. The exit code
is `3` when any pair failed on input or parsing, `5` on storage failures, and `1` for other
failures; an all-completed batch exits `0`. Batch mode is deterministic-only, stores analyses by
default (honoring `--no-store`), and with `--out` writes `roleproof-batch.json`,
`roleproof-batch.md`, and per-pair `roleproof-batch-pair-<n>.json`/`.md` reports.

## Automation

`roleproof serve` exposes stable local automation endpoints in addition to the browser routes:

```powershell
Invoke-RestMethod http://localhost:4173/api/automation
Invoke-RestMethod http://localhost:4173/api/automation/analyze `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"schemaVersion":"1.0","resumeText":"Fictional TypeScript experience","jobText":"Required: TypeScript"}'
```

`POST /api/automation/analyze` is deterministic-only, does not persist, and returns the canonical
`1.0` analysis envelope. The CLI also supports explicit webhook delivery of the JSON analysis or
batch envelope:

```powershell
pnpm exec roleproof analyze `
  --resume fixtures/phase-1/strong-match/resume.txt `
  --job fixtures/phase-1/strong-match/job.txt `
  --no-ai --no-store --format json --stdout `
  --webhook https://automation.example.test/roleproof `
  --confirm-webhook-transmission
```

Webhook delivery is never automatic. Non-local webhook URLs require
`--confirm-webhook-transmission`, response bodies are not logged, and JSON stdout remains the
requested analysis envelope. `roleproof mcp` provides a local stdio JSON-RPC MCP-compatible tool
named `roleproof_analyze` for plaintext deterministic analysis. The public `@roleproof/plugin-api`
package exposes `analyzeText` and `renderAnalysis` for local plugins, and the repository root
`action.yml` defines a composite GitHub Action for deterministic `roleproof analyze` runs.

## Local Web Server

```powershell
pnpm exec roleproof serve
```

The local server starts on `http://localhost:4173` by default and exposes a responsive local
Vue/Vite workspace with Vue Router, Pinia, a RoleProof proof-mark favicon, privacy-visible status
copy, and no account, telemetry, or cloud connection requirement. The browser Analyze form streams
`POST /api/analyze/stream`, which accepts schema-versioned résumé/job text and returns the same
deterministic `1.0` analysis envelope as the CLI, or an enhanced `2.0` envelope when AI succeeds.
Provider setup, destination, endpoint, and redaction categories are visible before consent;
provider failure returns a labeled deterministic fallback. Results keep hard blockers, matched
evidence, missing requirements, unsupported claims, safe résumé emphasis, confirmation-required
suggestions, and interview topics visible with their truth classifications. JSON and Markdown
downloads reuse the canonical reporters. The Analyze screen accepts TXT résumés up to 1 MB and
PDF/DOCX résumés up to 10 MB; selecting a file does not transmit it, and explicit analysis sends it
only to the local server. Job URLs are fetched by the local server only when analysis runs; fetched
postings include source classification, ATS detection, retrieval metadata, and removed-page safety
checks in the analysis metadata. Analyses persist to the same local database the CLI uses: the History
screen lists and searches stored reports, opens a stored report on its own page, and deletes a report
when asked; the Settings screen reads and saves local AI, redaction, provider credential status, and
output preferences.

The landing page is available at `/`; the focused résumé/job comparison workspace is available at
`/analyze`, stored analyses at `/history`, and local settings at `/settings`.

## Local Storage

```powershell
pnpm exec roleproof init
pnpm exec roleproof profile create --name "Fictional Candidate"
pnpm exec roleproof profile show --profile <profile-id>
pnpm exec roleproof profile evidence add --profile <profile-id> --resume fixtures/phase-1/strong-match/resume.txt
pnpm exec roleproof profile evidence add --profile <profile-id> --category skill --name TypeScript --description "Built fictional TypeScript services."
pnpm exec roleproof profile evidence edit --evidence <evidence-id> --description "Updated fictional evidence."
pnpm exec roleproof profile evidence remove --evidence <evidence-id>
pnpm exec roleproof history --profile <profile-id>
pnpm exec roleproof report show --analysis <analysis-id> --format json
pnpm exec roleproof search --query TypeScript
pnpm exec roleproof data purge --yes
```

Storage commands default to text output and support `--format json`; `report show` supports
`markdown` or `json`. Resume imports and manual evidence notes are profile-scoped. `history` lists
stored analyses, and `search` queries stored documents, jobs, career evidence, and analysis
reports. Permanent deletion is noninteractive and requires `data purge --yes`.

## Docker

A multi-stage `Dockerfile` builds a self-contained `roleproof` image on `node:22-alpine` that runs
as an unprivileged user:

```powershell
docker build -t roleproof .
docker run --rm -v "$PWD/fixtures:/work:ro" roleproof analyze `
  --resume /work/phase-1/strong-match/resume.txt `
  --job /work/phase-1/strong-match/job.txt `
  --no-ai --no-store --format json --stdout
```

Mount your own résumé and job files as a read-only volume and pass their container paths to the
same flags the CLI accepts, including `--stdin-job`/`--stdin-resume` with `docker run -i`. Run
`node scripts/docker-smoke.mjs` to build the image and validate file and piped analysis inside a
container; CI runs the same check on every push and pull request.

For local development, `docker-compose.yml` wires up the image build and mounts `./fixtures`
read-only as `/work`:

```powershell
docker compose run --rm roleproof analyze `
  --resume /work/phase-1/strong-match/resume.txt `
  --job /work/phase-1/strong-match/job.txt `
  --no-ai --no-store --format json --stdout
```

Pipe a job description instead of a file with `-T` (no TTY):

```powershell
Get-Content fixtures/phase-1/strong-match/job.txt -Raw |
  docker compose run -T --rm roleproof analyze `
    --resume /work/phase-1/strong-match/resume.txt `
    --stdin-job --no-ai --no-store --format json --stdout
```

`--build` rebuilds the image when the workspace changes.

## Workspace

- `apps/cli`: Commander-based command-line shell
- `apps/web`: local Fastify server and Vue/Vite browser workflow
- `packages/shared`: canonical Zod schemas and inferred TypeScript domain types
- `packages/core`: deterministic extraction, evidence-aware matching, blockers, scoring, and recommendations
- `packages/parsers`: bounded plaintext, PDF, and DOCX extraction
- `packages/reporters`: validated JSON and Markdown rendering
- `packages/providers`: privacy-gated provider orchestration and OpenAI-compatible adapters
- `packages/storage`: Kysely repositories and migrations backed by `better-sqlite3`
- `packages/plugin-api`: deterministic local plugin API for automation integrations
- `docs`: architecture and engineering documentation

Shared schemas are defined before handlers or analysis behavior. Business logic must remain
outside CLI handlers and future UI components.

Release maintainers should follow [`docs/releasing.md`](./docs/releasing.md). Package publication is
separate from building or testing the local workspace.

## Privacy

RoleProof keeps resume, job, profile, evidence, and analysis data in local SQLite storage by default
and has no telemetry. Deterministic analysis performs no provider request. In browser and CLI AI
mode, an explicitly selected provider sends minimized, redacted summaries to the displayed
destination only after consent; hosted/custom transmission requires confirmation. `--no-store` does
not write analysis content; with an explicit `--profile`, it opens the existing database read-only
and query-only so SQLite can include committed WAL content. See [`docs/privacy.md`](./docs/privacy.md)
for transmission details.

## Limitations

- Deterministic extraction uses version-controlled aliases, relationships, headings, and explicit
  wording. Ambiguous roles are marked for manual review.
- Unrecognized mandatory requirements are retained as `unknown`; lack of a normalization rule is
  not presented as proof that the candidate lacks the experience, and unknown mandatory facts
  require manual review.
- Learning, interest, exposure, negated claims, and unverified duration are not promoted to direct
  production experience. Direct résumé evidence requires affirmative context in the same clause.
- Missing authorization, clearance, license, education, location, or salary evidence does not
  become a blocker.
- Related skills never become direct experience, and transitive skill relationships are not used.
- Profile-wide evidence is used only with an explicit `--profile`; inferred evidence always
  requires confirmation and contributes zero points.
- Local persistence uses Kysely with `better-sqlite3` at `~/.roleproof/roleproof.db` by default.
- Read-only profile analysis rejects a database with live uncheckpointed WAL content.
- `data purge` requires `--yes` and removes the database plus its WAL and SHM sidecars.
- Scores describe evidence-based fit only and do not predict employer outcomes.
- Analysis is bounded to 500 semantic requirements and 100 evidence references per match; exceeding
  the requirement limit produces a manual-review result.
- Pattern redaction is best-effort. Review the transmission preview and use repeatable
  `--redact-term` values for sensitive text that a pattern may not recognize.

## License

RoleProof is available under the [MIT License](./LICENSE).

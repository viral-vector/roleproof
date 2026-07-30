# RoleProof

RoleProof is a local-first, evidence-based job-fit analysis project for truthful technical
applications. Its goal is to compare real career evidence with job requirements without
inventing experience or presenting a fit score as an interview or hiring probability.

## Project Status

Phase 4 has started with a local Fastify server foundation behind `roleproof serve`. RoleProof
accepts plaintext or PDF resumes and plaintext job descriptions, stores profiles and career
evidence, retains analysis history, supports full-text search, and renders schema-versioned JSON or
Markdown. Phase 3 optional evidence-constrained AI enhancement remains available through the CLI.

The complete web UI workflow and job URL fetching are not implemented. See
[`ROLEPROOF_BUILD_SPEC.md`](./docs/ROLEPROOF_BUILD_SPEC.md) for the phased product specification.

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
`--no-store`, `--profile`, salary targets, location, and remote preference. PDF input is supported
for resumes; job descriptions must be plaintext.

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

## Local Web Server

```powershell
pnpm exec roleproof serve
```

The Phase 4 server starts on `http://localhost:4173` by default and exposes local API foundations
without requiring an account, telemetry, or cloud connection. The full upload/analyze/results UI is
still in progress.

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

## Workspace

- `apps/cli`: Commander-based command-line shell
- `apps/web`: local Fastify web server foundation
- `packages/shared`: canonical Zod schemas and inferred TypeScript domain types
- `packages/core`: deterministic extraction, evidence-aware matching, blockers, scoring, and recommendations
- `packages/parsers`: bounded plaintext and PDF extraction
- `packages/reporters`: validated JSON and Markdown rendering
- `packages/providers`: privacy-gated provider orchestration and OpenAI-compatible adapters
- `packages/storage`: Kysely repositories and migrations backed by `better-sqlite3`
- `docs`: architecture and engineering documentation

Shared schemas are defined before handlers or analysis behavior. Business logic must remain
outside CLI handlers and future UI components.

Release maintainers should follow [`docs/releasing.md`](./docs/releasing.md). Package publication is
separate from building or testing the local workspace.

## Privacy

RoleProof keeps resume, job, profile, evidence, and analysis data in local SQLite storage by
default and has no telemetry. Deterministic analysis performs no provider request. An explicitly
selected provider sends minimized, redacted summaries to the displayed destination only;
hosted/custom transmission requires confirmation. `--no-store` does not write analysis content;
with an explicit `--profile`, it opens the existing database read-only and query-only so SQLite can
include committed WAL content. See [`docs/privacy.md`](./docs/privacy.md) for transmission details.

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

# RoleProof

RoleProof is a local-first, evidence-based job-fit analysis project for truthful technical
applications. Its goal is to compare real career evidence with job requirements without
inventing experience or presenting a fit score as an interview or hiring probability.

## Project Status

Phase 1 provides a deterministic CLI MVP. It accepts plaintext or PDF resumes and plaintext job
descriptions, normalizes skills, distinguishes exact and related evidence, detects explicit hard
blockers, produces explainable scores, and renders schema-versioned JSON or Markdown.

SQLite persistence, AI providers, job URL fetching, the local API, and the web UI are not
implemented. See [`ROLEPROOF_BUILD_SPEC.md`](./docs/ROLEPROOF_BUILD_SPEC.md) for the phased product
specification.

## Requirements

- Node.js 22 or newer
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

Supported Phase 1 options include `--format markdown|json|both`, `--out`, `--stdout`, `--no-ai`,
`--no-store`, salary targets, location, and remote preference. PDF input is supported for resumes;
job descriptions must be plaintext.

Single formats write to stdout unless `--out` is provided. `--format both` writes
`roleproof-analysis.json` and `roleproof-analysis.md` to `--out`, or to the current directory when
`--out` is omitted. Both formats cannot share stdout because that would invalidate JSON output.

Exit code `3` identifies file or parsing errors. Exit code `10` means analysis succeeded but found
an explicit hard eligibility blocker. JSON output remains valid in the blocker case.

## Workspace

- `apps/cli`: Commander-based command-line shell
- `packages/shared`: canonical Zod schemas and inferred TypeScript domain types
- `packages/core`: deterministic extraction, matching, blockers, scoring, and recommendations
- `packages/parsers`: bounded plaintext and PDF extraction
- `packages/reporters`: validated JSON and Markdown rendering
- `docs`: architecture and engineering documentation

Shared schemas are defined before handlers or analysis behavior. Business logic must remain
outside CLI handlers and future UI components.

## Privacy

RoleProof keeps resume and job data local. Phase 1 has no telemetry, networking, database,
provider integration, or hidden persistence. `--no-store` is an explicit no-persistence guarantee;
files requested with `--out` are report exports, not analysis history.

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
- Scores describe evidence-based fit only and do not predict employer outcomes.
- Analysis is bounded to 500 semantic requirements and 100 evidence references per match; exceeding
  the requirement limit produces a manual-review result.

## License

RoleProof is available under the [MIT License](./LICENSE).

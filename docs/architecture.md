# Architecture

## Phase 4 Boundary

Phase 4 has started from the local server boundary. RoleProof provides local deterministic,
evidence-aware analysis with SQLite storage, optional AI enhancement, and a Fastify server
foundation for the local web UI. The implemented dependency direction is:

```text
apps/cli
  |--> apps/web
  |--> packages/parsers ----|
  |--> packages/core -------|--> packages/shared
  |--> packages/reporters --|
  |--> packages/providers --|
  |--> packages/storage --------> packages/shared
```

`packages/shared` is the canonical contract package. It owns strict Zod schemas and derives
TypeScript types from those schemas. Other packages may depend on shared contracts; shared must
not depend on application or behavior packages.

Normalization data remains version controlled in root `data/` and is copied into the core package
during builds so packaged analysis does not depend on the caller's working directory.

## Package Responsibilities

### CLI

`apps/cli` owns command parsing, stream routing, report-file writes, and process exit behavior. The
`analyze` action delegates parsing, analysis, storage, and rendering to their packages. It does not
match or score evidence. Storage is enabled by default; `--no-store` bypasses storage unless an
explicit profile requires a read-only profile snapshot. The `serve` action starts the local web
server and does not implement analysis behavior itself.

### Web

`apps/web` owns the local Fastify server foundation for Phase 4. It exposes local API routes without
requiring accounts, telemetry, or cloud dependencies. Analysis endpoints and UI workflow screens must
delegate to the same core, parser, reporter, storage, and provider packages used by the CLI.

### Shared

`packages/shared` defines the public domain contract for candidate profiles, career evidence, job
requirements, evidence matches, unsupported claims, suggestions, metadata, and analysis results.
Objects reject unknown fields at the boundary. `AnalysisResult` and the deterministic analysis
envelope remain at schema version `1.0`; the enhanced envelope is version `2.0` and contains the
unchanged analysis plus a separate AI sidecar.

The score ranges currently represented by schemas are:

- `overallScore`: `0..100`
- `EvidenceMatch.score`: `0..1`
- `confidence`: `0..1`

Evidence match scores use the specification's canonical values: `direct` is `1`,
`strongly-related` is `0.75`, `partially-related` is `0.4`, and all unsupported, unknown, or
confirmation-required classifications are `0`. A supported match must reference evidence IDs.

Deterministic CLI JSON is `{ "schemaVersion": "1.0", "analysis": {} }`. Enhanced JSON is
`{ "schemaVersion": "2.0", "analysis": {}, "aiEnhancement": {} }`. JSON stdout contains one
validated envelope only, including provider fallback and blocker exits.

### Core

`packages/core` owns versioned normalization data, explicit evidence and requirement extraction,
evidence-aware non-transitive matching, blockers, explainable scoring, recommendations, stable IDs,
and deterministic orchestration. Its evidence-aware entry point accepts profile evidence through a
shared schema and does not depend on storage. Inferred evidence remains confirmation-only and earns
zero points. Requirement importance is resolved clause-by-clause, and eligibility blockers consume
the resulting structured required requirements rather than independently guessing qualification
headings. Repeated evidence and semantic requirements are deduplicated, match evidence references
are bounded, and output ordering uses locale-independent comparison. Hard blockers remain separate
from the numeric score.

### Parsers

`packages/parsers` extracts bounded untrusted document content without assigning career evidence.
It normalizes plaintext, extracts PDF text, rejects blank or binary-like input, and enforces byte,
page, image, and timeout limits before or during extraction. PDF.js resources are released after
completion and on timeout. Phase 2 accepts PDF resumes and plaintext jobs.

### Reporters

`packages/reporters` validates and renders `AnalysisResult` values without recalculating them. JSON
uses the shared envelope schema; Markdown displays blockers, classifications, evidence IDs, and
score contributions.

### Storage

`packages/storage` owns Kysely repositories, the `better-sqlite3` connection, migrations,
duplicate detection, analysis history, evidence-reference snapshots, FTS5 search, and complete
database-file purge. It defaults to `~/.roleproof/roleproof.db`, enables foreign keys and WAL for
writable file databases, and remains outside the deterministic core.

Normal analysis stores profiles, resume documents and extracted evidence, jobs and requirements,
analysis results, evidence references, and Markdown reports. Profile-wide evidence participates in
analysis only when the caller explicitly supplies `--profile`. `--no-store --profile` opens the
existing SQLite database read-only so SQLite includes a consistent view of live WAL content.

### Providers

`packages/providers` owns provider-neutral redaction, transmission manifests, operation sequencing,
strict output/evidence validation, budgets, sanitized errors, and deterministic fallback. OpenAI
and OpenAI-compatible transport adapters use native `fetch`; provider-specific responses do not
cross into core. Adapters reject calls that did not pass through the trusted redaction
orchestrator. AI output is a sidecar and cannot modify deterministic scores, recommendations,
matches, or blockers.

## Permanent Boundaries

- Shared Zod schemas define process and package boundaries.
- CLI, API, and UI layers delegate business decisions to core packages.
- Parsers extract content; they do not decide match classifications.
- Reporters render results; they do not recalculate scores.
- Provider-specific and storage-specific code stay outside the deterministic core.
- No package may treat resume or job text as executable instructions.
- Related experience must never be represented as direct experience.

## Deferred Architecture

The complete web UI workflow remains in Phase 4. URL analysis begins in Phase 5, and automation
integrations begin in Phase 6. None is required to use the deterministic CLI, local storage, or
optional provider enhancement.

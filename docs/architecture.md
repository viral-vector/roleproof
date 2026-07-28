# Architecture

## Phase 1 Boundary

Phase 1 provides local deterministic analysis without storage, providers, a server, or a web UI.
The implemented dependency direction is:

```text
apps/cli
  |--> packages/parsers ----|
  |--> packages/core -------|--> packages/shared
  |--> packages/reporters --|
```

`packages/shared` is the canonical contract package. It owns strict Zod schemas and derives
TypeScript types from those schemas. Other packages may depend on shared contracts; shared must
not depend on application or behavior packages.

Normalization data remains version controlled in root `data/` and is copied into the core package
during builds so packaged analysis does not depend on the caller's working directory.

## Package Responsibilities

### CLI

`apps/cli` owns command parsing, stream routing, report-file writes, and process exit behavior. The
`analyze` action delegates parsing, analysis, and rendering to their packages. It does not match or
score evidence.

### Shared

`packages/shared` defines the public domain contract for candidate profiles, career evidence, job
requirements, evidence matches, unsupported claims, suggestions, metadata, and analysis results.
Objects reject unknown fields at the boundary. `AnalysisResult` is fixed to schema version `1.0`.

The score ranges currently represented by schemas are:

- `overallScore`: `0..100`
- `EvidenceMatch.score`: `0..1`
- `confidence`: `0..1`

Evidence match scores use the specification's canonical values: `direct` is `1`,
`strongly-related` is `0.75`, `partially-related` is `0.4`, and all unsupported, unknown, or
confirmation-required classifications are `0`. A supported match must reference evidence IDs.

The CLI JSON envelope is `{ "schemaVersion": "1.0", "analysis": {} }`. JSON stdout contains this
envelope only, including when a blocker produces exit code `10`.

### Core

`packages/core` owns versioned normalization data, explicit evidence and requirement extraction,
non-transitive matching, blockers, explainable scoring, recommendations, stable IDs, and
deterministic orchestration. Requirement importance is resolved clause-by-clause, and eligibility
blockers consume the resulting structured required requirements rather than independently guessing
qualification headings. Repeated evidence and semantic requirements are deduplicated, match
evidence references are bounded, and output ordering uses locale-independent comparison. Hard
blockers remain separate from the numeric score.

### Parsers

`packages/parsers` extracts bounded untrusted document content without assigning career evidence.
It normalizes plaintext, extracts PDF text, rejects blank or binary-like input, and enforces byte,
page, image, and timeout limits before or during extraction. PDF.js resources are released after
completion and on timeout. Phase 1 accepts PDF resumes and plaintext jobs.

### Reporters

`packages/reporters` validates and renders `AnalysisResult` values without recalculating them. JSON
uses the shared envelope schema; Markdown displays blockers, classifications, evidence IDs, and
score contributions.

## Permanent Boundaries

- Shared Zod schemas define process and package boundaries.
- CLI, API, and UI layers delegate business decisions to core packages.
- Parsers extract content; they do not decide match classifications.
- Reporters render results; they do not recalculate scores.
- Provider-specific and storage-specific code stay outside the deterministic core.
- No package may treat resume or job text as executable instructions.
- Related experience must never be represented as direct experience.

## Deferred Architecture

SQLite storage begins in Phase 2, optional AI providers in Phase 3, the local API and web UI in
Phase 4, URL analysis in Phase 5, and automation integrations in Phase 6. None of these components
is required to install or use the deterministic CLI foundation.

# Architecture

## Phase 0 Boundary

Phase 0 provides package boundaries and public schemas but no job-fit analysis behavior. The
implemented dependency direction is:

```text
apps/cli

packages/core       packages/parsers       packages/reporters
       \                    |                    /
                    packages/shared
```

`packages/shared` is the canonical contract package. It owns strict Zod schemas and derives
TypeScript types from those schemas. Other packages may depend on shared contracts; shared must
not depend on application or behavior packages.

The package shells do not import shared contracts until they have a current use case. This avoids
creating speculative interfaces solely to demonstrate the intended dependency graph.

## Package Responsibilities

### CLI

`apps/cli` owns command parsing, stream routing, and process exit behavior. It must orchestrate
core behavior rather than implement analysis. Phase 0 supports only help, version, and invalid
argument handling.

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

The specified CLI JSON envelope is `{ "schemaVersion": "1.0", "analysis": {} }`. Phase 0 does
not produce this output; its implementation and compatibility tests begin in Phase 1.

### Core

`packages/core` is reserved for deterministic analysis orchestration and truth rules. Analysis is
introduced in Phase 1.

### Parsers

`packages/parsers` will extract untrusted document content without assigning unsupported career
experience. Plaintext and PDF parsing are introduced in Phase 1.

### Reporters

`packages/reporters` will render validated `AnalysisResult` values without recalculating them. JSON
and Markdown reporting are introduced in Phase 1.

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

# Changelog

## Unreleased

### Phase 2 Storage

- Added local SQLite persistence through Kysely and `better-sqlite3`, defaulting to
  `~/.roleproof/roleproof.db`.
- Added profile and career-evidence management, default analysis persistence, stored reports and
  evidence-reference snapshots, analysis history, FTS5 search, and confirmed database/WAL/SHM
  purge through `data purge --yes`.
- Added explicit `--profile` analysis with profile-wide evidence. Inferred evidence remains
  confirmation-only and contributes zero points.
- Added `--no-store` analysis without writes, including a read-only profile snapshot that rejects
  live uncheckpointed WAL content.
- Added schema-versioned command JSON envelopes without changing the Analysis envelope version
  `1.0`.

## 0.1.0 - 2026-07-28

RoleProof's first deterministic CLI release.

### Added

- Local plaintext and PDF resume parsing with bounded file, text, page, image, and timeout limits.
- Plaintext job requirement extraction with required, preferred, contextual, and eligibility categories.
- Version-controlled skill aliases and non-transitive related-skill relationships.
- Evidence-linked direct, strongly related, partially related, unsupported, unknown, and confirmation-required classifications.
- Explainable deterministic scoring with auditable contributions and separate hard blockers.
- Schema-versioned JSON and human-readable Markdown reports.
- Cross-platform CLI behavior, exit codes, fictional acceptance fixtures, and Windows, Linux, and macOS CI.

### Safety

- Related experience is never promoted to direct experience.
- Missing candidate facts remain unknown and require review rather than becoming assumed blockers.
- Negated, learning-only, interest-only, and unverified-duration claims are not treated as direct evidence.
- Phase 1 performs no telemetry, network requests, provider calls, or hidden persistence.

The fit score describes support in supplied evidence and does not predict employer outcomes.

# Changelog

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

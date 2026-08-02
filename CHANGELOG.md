# Changelog

## 0.4.0 - 2026-08-02

RoleProof's local web UI release for browser-based deterministic analysis, optional AI-enhanced
guidance, local history, settings, and provider consent workflows.

### Phase 4 Local Web UI

- Added the local Fastify/Vue web UI behind `roleproof serve`, including pasted text, TXT/PDF/DOCX
  résumé upload, deterministic analysis, JSON/Markdown downloads, local history search/detail views,
  and settings.
- Added AI-enhanced browser analysis using the same provider layer and schemas as the CLI, with
  visible provider destination, endpoint, redaction categories, consent invalidation, and labeled
  deterministic fallback when enhancement is unavailable.
- Preserved local-first privacy: selected files are not parsed or sent until analysis is explicitly
  run, model-list and health checks send no career content, and browser uploads remain local unless a
  configured provider is explicitly confirmed.
- Added source-aware résumé provenance and analysis identity so uploaded file format, safe filename,
  content hash, confidence, and parser warnings remain auditable without turning related experience
  into direct evidence.
- Added browser end-to-end validation in CI with Playwright Chromium and automatic cleanup of
  temporary E2E SQLite databases.

## 0.3.0 - 2026-07-30

RoleProof's optional AI provider release for evidence-constrained enhancement of deterministic
analysis.

### Phase 3 Providers

- Added explicit OpenAI and OpenAI-compatible provider support, including Ollama and LM Studio
  configuration documentation.
- Added provider health checks, structured output validation, redaction manifests, token/cost usage
  tracking, and deterministic fallback with exit code `4`.
- Added enhanced JSON envelope version `2.0` and enhanced Markdown sections while preserving the
  deterministic Analysis envelope at version `1.0`.
- Added immutable AI enhancement sidecars and sanitized provider-call audit metadata in SQLite.
- Kept AI subordinate to evidence: recommendations cite supplied evidence, additions require user
  confirmation, and deterministic scores, matches, recommendations, and blockers remain unchanged.
- Preserved local-first privacy: providers are never auto-selected from environment variables,
  hosted/custom transmission requires explicit confirmation, and provider failures return the
  deterministic baseline.

## 0.2.0 - 2026-07-29

RoleProof's local SQLite storage release for the deterministic CLI.

### Phase 2 Storage

- Added local SQLite persistence through Kysely and `better-sqlite3`, defaulting to
  `~/.roleproof/roleproof.db`.
- Added profile and career-evidence management, default analysis persistence, stored reports and
  evidence-reference snapshots, analysis history, FTS5 search, and confirmed database/WAL/SHM
  purge through `data purge --yes`.
- Added explicit `--profile` analysis with profile-wide evidence. Inferred evidence remains
  confirmation-only and contributes zero points.
- Added `--no-store` analysis without analysis-content writes. Explicit profiles are opened
  read-only and query-only so SQLite includes committed WAL content.
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

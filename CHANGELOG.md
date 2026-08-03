# Changelog

## 0.5.1 - 2026-08-03

Deterministic accuracy and safety fixes for job URL fetching, structured HTML extraction, and core
requirement matching. Analysis behavior changed; the analysis envelope and CLI contracts are
unchanged.

### URL and extraction safety

- Rejected job URL destinations that are loopback, private, link-local, or carry embedded
  credentials, and validated every redirect destination before following it.
- Enforced one total fetch deadline across redirects and body reads, and returned stable errors for
  authentication failures, server errors, and removed or unavailable postings.
- Flagged blocked pages (access-denied, captcha, and bot-verification screens) as failed fetches
  instead of analyzing their boilerplate.
- Marked unverifiable hostnames as `unknown` source classification instead of assuming an official
  employer posting.
- Replaced the fragile regular-expression HTML flattening with a `parse5`-based structural
  extractor that selects the matching `JobPosting` JSON-LD, excludes forms, navigation, footers,
  and sidebars, and preserves structured salary and location lines.

### Deterministic core accuracy

- Read requested experience ranges (`7-10 years`, `7 to 10 years`) at their minimum bound so a
  range never claims more experience than the posting demands.
- Normalized generic multiword responsibilities only when the versioned taxonomy defines them;
  unrecognized multiword requirements stay unnormalized and require manual review instead of being
  reported as missing experience.
- Added taxonomy coverage for reviewed concepts (Problem solving, Distributed APIs, LLM, SaaS,
  Microservices, Service-oriented architecture, and AI coding assistants) and made ambiguous short
  aliases such as `Go` case-sensitive while spelled-out forms like `Golang` remain case-insensitive.
- Kept salary ranges, tiered compensation, benefits, and hosted application-form fields out of
  requirement extraction.
- Recognized conversational requirement headings such as "What do we need from you?" as required
  qualifications without lowering confidence.
- Used no-sponsorship wording consistently between evidence matching and hard blockers, including
  "sponsorship is not offered" and "we do not offer sponsorship" forms.
- Allowed an explicit years-of-experience claim that names the same skill (for example `14+ years
of TypeScript experience`) to satisfy a requested duration, while year-only boundary dates are
  still never inferred as full durations.

## 0.5.0 - 2026-08-02

RoleProof's job URL source analysis release for bounded URL fetching, source classification, ATS
detection, and persisted retrieval metadata across CLI and local web workflows.

### Phase 5 Job URL Source Analysis

- Added bounded HTTP(S) job URL fetching with byte, timeout, and redirect limits before deterministic
  parsing and analysis.
- Added source metadata for fetched postings, including original URL, final URL, retrieval time,
  status, content type, source classification, ATS provider, confidence, and warnings.
- Added removed or unavailable page detection so deleted postings fail safely instead of becoming
  empty or misleading analyses.
- Persisted job source metadata in SQLite and keyed URL-backed job hashes to fetched content instead
  of the URL string.
- Surfaced job source metadata in JSON and Markdown outputs and added browser URL input with local
  fetch disclosure. URL fetching remains explicit and does not involve hosted providers.

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

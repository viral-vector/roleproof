# JSON Contract

RoleProof machine-readable analysis uses schema version `1.0`:

```json
{
  "schemaVersion": "1.0",
  "analysis": {
    "schemaVersion": "1.0"
  }
}
```

The envelope and analysis are validated with the canonical Zod schemas in `packages/shared`.
Unknown fields are rejected at current boundaries. JSON stdout contains no logging, progress text,
or Markdown.

The Analysis envelope remains unchanged at version `1.0`. Phase 2 storage commands add a separate
strict command envelope rather than adding fields to the Analysis envelope:

```json
{
  "schemaVersion": "1.0",
  "command": "history",
  "data": {
    "history": []
  }
}
```

Command envelope names are `init`, `profile.create`, `profile.show`, `profile.evidence.add`,
`profile.evidence.edit`, `profile.evidence.remove`, `report.show`, `history`, `search`,
`data.purge`, `providers.list`, `providers.models`, and `providers.test`. Their `data` values
contain the corresponding profile, document, career-evidence, analysis-history, search-result,
provider, or purge-result schemas. This is additive and does not change machine-readable output from
`analyze --format json`.

Successful provider enhancement uses a new major envelope so strict `1.0` consumers never mistake
an enhanced payload for the deterministic contract:

```json
{
  "schemaVersion": "2.0",
  "analysis": {
    "schemaVersion": "1.0"
  },
  "aiEnhancement": {
    "schemaVersion": "1.0",
    "baselineAnalysisId": "analysis-id"
  }
}
```

The `analysis` object is the unchanged deterministic result. `aiEnhancement` contains validated
interpretations, evidence mappings, confirmation-gated additions, suggestions, and sanitized
provider execution metadata. Provider fallback emits the deterministic `1.0` envelope and exits
with code `4`. Enhanced `report.show` command output similarly uses command-envelope version `2.0`.

The local API reuses these contracts. `POST /api/analyze` accepts a strict deterministic
request envelope by default:

```json
{
  "schemaVersion": "1.0",
  "mode": "deterministic",
  "resumeText": "Fictional resume text",
  "jobText": "Fictional job text"
}
```

Phase 5 adds optional job URL input to the same request envelope. A request may provide nonblank
`jobText`, `jobUrl`, or both. When `jobUrl` is present, the local server fetches the posting with
bounded parser limits and analyzes the fetched job text:

```json
{
  "schemaVersion": "1.0",
  "mode": "deterministic",
  "resumeText": "Fictional resume text",
  "jobText": "",
  "jobUrl": "https://boards.greenhouse.io/fictionalco/jobs/123"
}
```

For browser AI mode, the same route accepts an explicit enhanced request only when provider
transmission is confirmed:

```json
{
  "schemaVersion": "1.0",
  "mode": "ai-enhanced",
  "confirmProviderTransmission": true,
  "resumeText": "Fictional resume text",
  "jobText": "Fictional job text"
}
```

Deterministic responses use the canonical analysis envelope version `1.0`. Successful AI-enhanced
responses use the enhanced envelope version `2.0` with `aiEnhancement`. If provider enhancement is
unavailable or invalid, the route returns the unchanged deterministic `1.0` envelope and records the
provider failure when storage is enabled. Responses never include stored provider settings.

URL-backed analyses include `analysis.metadata.jobSource` when retrieval succeeds:

```json
{
  "schemaVersion": "1.0",
  "url": "https://boards.greenhouse.io/fictionalco/jobs/123",
  "finalUrl": "https://boards.greenhouse.io/fictionalco/jobs/123",
  "retrievedAt": "2026-01-01T00:00:00.000Z",
  "statusCode": 200,
  "contentType": "text/html; charset=utf-8",
  "sourceClassification": "official-ats",
  "atsProvider": "greenhouse",
  "removedOrUnavailable": false,
  "confidence": 0.9,
  "warnings": []
}
```

`sourceClassification` is one of `official-company`, `official-ats`, `aggregator`, `unknown`, or
`unavailable`. `atsProvider` is a detected ATS value such as `greenhouse`, `lever`, `ashby`,
`workday`, `icims`, `smartrecruiters`, `bamboohr`, `workable`, `oracle`, `successfactors`, or
`unknown`. Removed or unavailable pages are rejected before analysis.

`warnings` entries use stable codes. Extraction-quality codes include `non-html-content`,
`low-text-content`, `semantic-extraction` (requirements came from a generic `main` or `article`
region rather than a structured container), and `generic-extraction` (requirements were pulled
from the whole page because no structured region was found).

When the server has storage, analyzed inputs and results are persisted and exposed through history
routes. `GET /api/history` returns a `LocalHistoryListResponseSchema` envelope:

```json
{
  "schemaVersion": "1.0",
  "history": [
    {
      "schemaVersion": "1.0",
      "id": "analysis-...",
      "overallScore": 84,
      "recommendation": "apply",
      "confidence": 0.92,
      "hasHardBlocker": false,
      "generatedAt": "2026-01-01T00:00:00.000Z",
      "jobId": "job-..."
    }
  ]
}
```

An optional `query` parameter (at most 500 characters) restricts the list to full-text search
matches across stored analysis reports; an omitted or empty query returns the stored items.
`GET /api/history/:id` returns the same canonical envelope as `POST /api/analyze` for a stored
analysis, and `DELETE /api/history/:id` removes the analysis (and the job description and
requirements only it references) and answers `{ "removed": true }`. Unknown ids answer `404` with a
content-free `{ "error" }` body.

`GET /api/settings` and `PUT /api/settings` use `LocalSettingsResponseSchema`:

```json
{
  "schemaVersion": "1.0",
  "settings": {
    "provider": "openai",
    "model": "fictional-model",
    "destination": "hosted",
    "baseUrl": "http://127.0.0.1:1234/v1",
    "redactEmployer": false,
    "redactClearance": false,
    "redactionTerms": ["project codename"],
    "defaultExportFormat": "markdown",
    "maxTotalTokens": 8192,
    "maxCostUsd": 0.1,
    "inputMicroUsdPerMillionTokens": 100000,
    "outputMicroUsdPerMillionTokens": 200000,
    "providerTimeoutMs": 30000,
    "structuredOutputMode": "json-schema"
  },
  "databasePath": "local"
}
```

All settings fields are optional in requests; `PUT` accepts any subset and persists a merged
result. An explicit `null` clears a stored value (the Settings screen uses `null` for "None"). The
merged settings must still be complete: a configured provider requires a model, and an
`openai-compatible` provider requires a base URL. A maximum cost requires both input and output
token rates because RoleProof does not assume model pricing. Token, cost, and timeout values are
bounded by the canonical provider configuration limits. Invalid merged settings answer `400`, and
settings and history routes answer `503` when the server has no storage.

Provider credentials use separate local-only routes. `GET /api/provider-credentials` returns status
only:

```json
{
  "schemaVersion": "1.0",
  "credentials": [
    { "provider": "openai", "configured": true, "source": "key-store" },
    { "provider": "openai-compatible", "configured": false, "source": "none" }
  ]
}
```

`PUT /api/provider-credentials` accepts `{ "provider", "apiKey" }` and stores the key in Windows
Credential Manager in the current local build. `DELETE /api/provider-credentials/:provider` removes
a stored key. Responses and logs never echo the key. Environment variables may satisfy credential
status with source `environment`, but they are not persisted.

`GET /api/provider-models` accepts query parameters `provider`, optional `destination`, optional
`baseUrl`, and optional current `model`. It calls the provider `/models` endpoint only and returns:

```json
{
  "schemaVersion": "1.0",
  "models": [{ "id": "phi4-mini:latest", "structuredOutputSupported": null }]
}
```

The route is used by the Settings model dropdown and does not accept or transmit résumé or job
content.

`POST /api/resume/parse` accepts one multipart field named `resume`. Upload metadata is validated by
`LocalResumeUploadMetadataSchema`: the safe base filename must end in `.txt`, `.pdf`, or `.docx`;
plaintext is limited to 1,000,000 bytes, and PDF and DOCX are limited to 10,000,000 bytes each. A
successful response follows `LocalResumeParseResponseSchema`:

```json
{
  "schemaVersion": "1.0",
  "text": "Fictional extracted resume text",
  "format": "pdf",
  "confidence": 0.5,
  "warnings": []
}
```

Current servers include `confidence`. The v1.0 response parser also accepts legacy responses that
omit it; clients must not submit resume provenance when parse confidence is unavailable.

Malformed, unsupported, empty, or oversized files return a content-free error. PDF page, image,
extracted-text, and timeout limits remain enforced by the canonical parser configuration; DOCX
extraction is bounded by the same input byte and extracted-text limits. The 400 body is
`{ "error": "Invalid resume file." }` with an optional `code` field when the parser identifies the
reason, from `binary-content`, `docx-error`, `empty-document`, `pdf-error`, `pdf-page-limit`,
`pdf-timeout`, or `size-limit`. The code is content-free: it never echoes file contents.

Important analysis fields include:

- `overallScore`: evidence-based fit from 0 through 100
- `recommendation`: `apply`, `stretch`, `skip`, or `manual-review`
- `confidence`: parsing and requirement confidence from 0 through 1
- `hardBlockers`: explicit eligibility mismatches, separate from score
- `matchedRequirements`: every assessed match, including unsupported and unknown classifications
- `missingRequirements`: requirement records corresponding to zero-value matches
- `scoreContributions`: requirement-level weight and points audit records
- `unsupportedClaims`: warnings against unsupported experience claims
- `suggestedEmphasis`: evidence-linked safe emphasis
- `suggestedAdditions`: additions that require confirmation where applicable
- `metadata`: deterministic mode, engine/data versions, parsing confidence, and optional job source
  retrieval metadata

Stored analyses retain an immutable `evidenceReferences` snapshot, returned by `report.show` in its
command envelope alongside `analysis`. Each reference contains:

- `evidenceId`: the ID cited by the analysis
- `sourceType`: `career-evidence`, `profile-fact`, or `resume-text`
- `sourceId`: the source record ID
- `sourceDocumentId`: the optional stored source-document ID
- `sourceText`: optional supporting source text
- `confidence`: `explicit`, `inferred`, or `user-confirmed`

Inferred references do not become scored evidence: matching classifies them
`requires-user-confirmation` with zero points.

`generatedAt` is operational metadata. Determinism comparisons ignore only this timestamp; IDs,
scores, classifications, explanations, contributions, and ordering remain stable for identical
inputs and configuration.

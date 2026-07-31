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
`data.purge`, `providers.list`, and `providers.test`. Their `data` values contain the corresponding
profile, document, career-evidence,
analysis-history, search-result, or purge-result schemas. This is additive and does not change
machine-readable output from `analyze --format json`.

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

The Phase 4 local API reuses these contracts. `POST /api/analyze` accepts a strict request envelope:

```json
{
  "schemaVersion": "1.0",
  "mode": "deterministic",
  "resumeText": "Fictional resume text",
  "jobText": "Fictional job text"
}
```

The response is the canonical deterministic analysis envelope version `1.0`; it does not include
provider settings or `aiEnhancement`.

`POST /api/resume/parse` accepts one multipart field named `resume`. Upload metadata is validated by
`LocalResumeUploadMetadataSchema`: the safe base filename must end in `.txt`, `.pdf`, or `.docx`;
plaintext is limited to 1,000,000 bytes, and PDF and DOCX are limited to 10,000,000 bytes each. A
successful response follows `LocalResumeParseResponseSchema`:

```json
{
  "schemaVersion": "1.0",
  "text": "Fictional extracted resume text",
  "format": "pdf",
  "warnings": []
}
```

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
- `metadata`: deterministic mode, engine/data versions, and parsing confidence

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

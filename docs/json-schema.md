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

`generatedAt` is operational metadata. Determinism comparisons ignore only this timestamp; IDs,
scores, classifications, explanations, contributions, and ordering remain stable for identical
inputs and configuration.

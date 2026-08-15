# Privacy

RoleProof has no telemetry. Deterministic analysis and `--no-ai` perform no provider request.
Analysis persists by default to a local SQLite database at `~/.roleproof/roleproof.db`; an absolute
path can be selected with the global `--db` option. AI enhancement is optional and transmits data
only after the user explicitly selects a provider and confirms the displayed destination. CLI
hosted/custom destinations require `--confirm-transmission`; the browser requires the
provider-transmission confirmation checkbox before it sends redacted analysis inputs.

## Inputs

- Resume and job files are read only after an explicit `analyze` command.
- Job URLs are fetched only after an explicit `analyze` command or browser analysis submission. URL
  fetching is performed by the local process, bounded by byte, redirect, and timeout limits, and
  accepts HTTP(S) only.
- Selecting a résumé in the browser does not send or parse it. The file is sent only to the local
  Fastify server after the user explicitly runs analysis.
- Parser configuration and filesystem byte size are validated before document content is loaded.
- PDF, DOCX, and plaintext content is treated as untrusted data, never executable instructions.
- PDF page, image, text, byte, and timeout limits are enforced, and PDF.js resources are destroyed
  after completion or timeout. DOCX extraction is bounded by the same input byte and extracted-text
  limits and never executes embedded document content.
- Parser errors identify the input path and corrective action without echoing document contents.
- Job URL errors are content-free and do not log fetched page bodies.
- The local parse endpoint logs only content-free failure reasons to the server's stderr, such as
  the parser error code and a static description; uploaded file contents never appear in these
  lines.
- Tests and repository fixtures contain fictional data only.
- Browser uploads are held in memory for parsing and are not persisted by the local parse endpoint.
  The persisted analysis record stores parsed résumé text and source provenance such as safe
  filename, format, content hash, confidence, and parser warnings when available. URL-backed job
  analyses store retrieval metadata such as URL, final URL, status, content type, source
  classification, ATS provider, confidence, and warnings.

## Outputs

- JSON or Markdown is written only to requested stdout or report destinations.
- Full resume and job text is not written to application logs or embedded in diagnostics.
- Explicit `--out` report files are exports and are not analysis history.
- Explicit `--webhook` sends the JSON analysis or batch envelope only to the user-supplied endpoint.
  Non-local webhook URLs require `--confirm-webhook-transmission`, delivery diagnostics are written
  to stderr, and webhook response bodies are never logged.

## Local Database

The SQLite database can contain profiles and preferences, parsed resume documents, manual evidence
notes, career evidence and source text, job descriptions and requirements, job source retrieval
metadata, complete analysis JSON, evidence-reference snapshots, Markdown reports, immutable
AI-enhancement sidecars, sanitized provider-call metadata, and settings.

FTS5 external-content indexes duplicate searchable text in index structures. This includes resume
and evidence-note text, job text, career-evidence names, descriptions and source fields, and stored
analysis report text. SQLite may also create `roleproof.db-wal` and `roleproof.db-shm` sidecars.

The local web server persists analyzed résumé text, jobs, and analysis reports into the same
database by default; the browser history screen reads and deletes only that stored data. Deleting a
history item also removes its job description and requirements when no other stored analysis
references them. Stored résumé documents and the evidence extracted from them are retained so the
same résumé can be analyzed against other jobs; history deletion does not remove them.

## No Store

- `analyze --no-store` without `--profile` does not open or create the database and writes no
  analysis content.
- `analyze --no-store --profile <id>` opens the existing database read-only and query-only; it does
  not migrate the schema or write analysis content. SQLite may temporarily manage WAL/SHM
  coordination files while producing a consistent view of concurrent committed data.
- Requested `--out` report exports are still written because they are explicit outputs.

Provider enhancement under `--no-store` does not persist the baseline, sidecar, or provider-call
metadata. An explicit profile still uses the existing database read-only.

## Provider Transmission

- Provider selection is explicit; API-key environment variables never activate AI.
- The local web Settings screen stores API keys only in Windows Credential Manager in the current
  local build. Settings API responses expose credential status only, never secret values.
- Browser AI mode displays provider, model, destination, endpoint, and redaction categories before
  the confirmation checkbox can enable transmission. Changing provider settings invalidates prior
  consent.
- Before a provider call, stderr displays provider, model, destination, endpoint origin, data
  categories, and enabled redaction categories.
- Provider model-list and health-check calls request endpoint metadata only; they do not include
  résumé or job content.
- OpenAI uses the fixed `https://api.openai.com` origin. A compatible `local` destination must use a
  loopback host. Hosted and custom compatible endpoints require HTTPS and credentials.
- Requests contain selected requirement text, deterministic classifications, and minimized evidence,
  resume, and job summaries. They do not contain an entire stored profile or unrelated evidence.
- Email, phone, and common address patterns are redacted by default and are disclosed in the browser
  before consent. Employer names, clearance details, and user-selected terms are redacted only when
  their corresponding options are enabled.
- Pattern redaction is best-effort and cannot recognize every sensitive value. Use repeatable
  `--redact-term` options for known sensitive names or phrases and review the preview before consent.
- Redirects are rejected. Responses are bounded, timed out, and strictly schema validated.
- No request body, response body, API key, full resume, or full job description is logged or stored
  as provider-call metadata.
- Provider failure returns the unchanged deterministic baseline. Successful earlier calls and the
  failed call's redaction manifest may be stored as sanitized usage/audit metadata when storage is
  enabled.
- In the browser, provider construction, credential, timeout, or validation failures return a labeled
  deterministic fallback rather than hiding blockers or AI status behind the score.

## Purge

`roleproof data purge --yes` permanently removes the selected database and its `-wal` and `-shm`
sidecars. The explicit `--yes` flag is required; there is no implicit or interactive deletion.

Purge also removes stored AI sidecars and provider-call metadata because they are contained in the
selected database.

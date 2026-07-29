# Privacy

RoleProof Phase 2 runs locally and performs no network requests, telemetry, or provider calls.
Analysis persists by default to a local SQLite database at `~/.roleproof/roleproof.db`; an absolute
path can be selected with the global `--db` option.

## Inputs

- Resume and job files are read only after an explicit `analyze` command.
- Parser configuration and filesystem byte size are validated before document content is loaded.
- PDF and plaintext content is treated as untrusted data, never executable instructions.
- PDF page, image, text, byte, and timeout limits are enforced, and PDF.js resources are destroyed
  after completion or timeout.
- Parser errors identify the input path and corrective action without echoing document contents.
- Tests and repository fixtures contain fictional data only.

## Outputs

- JSON or Markdown is written only to requested stdout or report destinations.
- Full resume and job text is not written to application logs or embedded in diagnostics.
- Explicit `--out` report files are exports and are not analysis history.

## Local Database

The SQLite database can contain profiles and preferences, parsed resume documents, manual evidence
notes, career evidence and source text, job descriptions and requirements, complete analysis JSON,
evidence-reference snapshots, Markdown reports, provider-call metadata reserved by the schema, and
settings. AI providers are not implemented.

FTS5 external-content indexes duplicate searchable text in index structures. This includes resume
and evidence-note text, job text, career-evidence names, descriptions and source fields, and stored
analysis report text. SQLite may also create `roleproof.db-wal` and `roleproof.db-shm` sidecars.

## No Store

- `analyze --no-store` without `--profile` does not open or create the database and writes no
  analysis content.
- `analyze --no-store --profile <id>` opens the existing database read-only and query-only; it does
  not migrate the schema or write analysis content. SQLite may temporarily manage WAL/SHM
  coordination files while producing a consistent view of concurrent committed data.
- Requested `--out` report exports are still written because they are explicit outputs.

## Purge

`roleproof data purge --yes` permanently removes the selected database and its `-wal` and `-shm`
sidecars. The explicit `--yes` flag is required; there is no implicit or interactive deletion.

AI providers are not implemented. No local document content can be transmitted to a hosted model
in Phase 2.

# Privacy

RoleProof Phase 1 runs locally and performs no network requests, telemetry, provider calls, or
database writes.

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
- `--no-store` guarantees no hidden persistence. Phase 1 has no storage subsystem.
- Explicit `--out` report files are exports and are not analysis history.
- Full resume and job text is not logged or embedded in parser diagnostics.

AI providers are not implemented. No local document content can be transmitted to a hosted model
in Phase 1.

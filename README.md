# RoleProof

RoleProof is a local-first, evidence-based job-fit analysis project for truthful technical
applications. Its goal is to compare real career evidence with job requirements without
inventing experience or presenting a fit score as an interview or hiring probability.

## Project Status

Phase 0 establishes the TypeScript monorepo, shared domain schemas, and CLI shell. The current
CLI supports `--help` and `--version` only.

Role analysis, document parsing, scoring, eligibility blockers, report generation, persistence,
AI providers, and the web UI are not implemented yet. See
[`ROLEPROOF_BUILD_SPEC.md`](./ROLEPROOF_BUILD_SPEC.md) for the phased product specification.

## Requirements

- Node.js 22 or newer
- pnpm 10.24.0 through Corepack

```powershell
corepack enable
corepack prepare pnpm@10.24.0 --activate
pnpm install
```

## Development

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:cli
pnpm exec roleproof --help
pnpm exec roleproof --version
```

## Workspace

- `apps/cli`: Commander-based command-line shell
- `packages/shared`: canonical Zod schemas and inferred TypeScript domain types
- `packages/core`: deterministic analysis package boundary
- `packages/parsers`: document parser package boundary
- `packages/reporters`: JSON and Markdown reporter package boundary
- `docs`: architecture and engineering documentation

Shared schemas are defined before handlers or analysis behavior. Business logic must remain
outside CLI handlers and future UI components.

## Privacy

RoleProof is designed to keep resume and job data local by default. Phase 0 has no networking,
telemetry, storage, document input, or provider integration.

## License

RoleProof is available under the [MIT License](./LICENSE).

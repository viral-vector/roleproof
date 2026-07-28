# Contributing to RoleProof

RoleProof accepts focused contributions that preserve its truthful, local-first, deterministic,
and automation-friendly product constraints.

## Setup

Install Node.js 22 or newer and activate the repository's pinned pnpm version:

```powershell
corepack enable
corepack prepare pnpm@10.24.0 --activate
pnpm install
```

## Development Rules

- Read `docs/ROLEPROOF_BUILD_SPEC.md` and `AGENTS.md` before changing behavior.
- Work within one product phase at a time.
- Keep business logic in domain packages, not CLI handlers or presentation components.
- Define Zod boundary schemas before implementing consumers.
- Use fictional, minimal test data only.
- Never convert adjacent experience into direct experience.
- Never add cloud transmission, telemetry, or external services silently.
- Do not describe fit scores as interview or hiring probabilities.

## Test-Driven Development

Behavior changes must follow Red, Green, Refactor, and Regression:

1. Add a focused test for the required public behavior.
2. Run it and confirm it fails for the expected missing behavior.
3. Implement the smallest change that makes the test pass.
4. Refactor only while tests remain green.
5. Run the applicable repository gates.

Report the test added, expected failure, observed failure, implementation, focused result, cleanup,
and final regression result with the contribution.

## Validation

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm test:cli` when CLI behavior changes. CI executes the same gates on Windows, Linux, and
macOS.

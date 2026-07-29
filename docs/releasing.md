# Releasing

RoleProof packages are configured for publication under the `@roleproof` npm scope. A release must
not be published until the release commit passes CI on Windows, Linux, and macOS.

## Prerequisites

- The worktree and index are clean.
- `main` or `master` contains the reviewed release commit.
- CI is green on all three operating systems.
- `npm whoami` succeeds for an account authorized to publish the `@roleproof` scope.
- The package versions and changelog agree with the intended Git tag.

## Validate

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:cli
```

Pack and install the six packages in a temporary directory before publishing. Verify that the
installed `roleproof` executable prints the release version and completes deterministic JSON and
Markdown analyses without access to the repository source tree.

## Publish

Publish in dependency order so every workspace dependency is available before the CLI:

```powershell
pnpm --filter @roleproof/shared publish --access public
pnpm --filter @roleproof/storage publish --access public
pnpm --filter @roleproof/core publish --access public
pnpm --filter @roleproof/parsers publish --access public
pnpm --filter @roleproof/reporters publish --access public
pnpm --filter @roleproof/cli publish --access public
```

Confirm the registry versions:

```powershell
npm view @roleproof/shared version
npm view @roleproof/storage version
npm view @roleproof/core version
npm view @roleproof/parsers version
npm view @roleproof/reporters version
npm view @roleproof/cli version
```

Only after all packages are available, create and push the signed or annotated Git tag and create
the GitHub release from the matching changelog entry.

## Failure Safety

- Never republish or overwrite an existing package version.
- Stop immediately if one package fails to publish.
- Do not tag a partial npm release as complete.
- Fix the cause, increment versions consistently, rerun every gate, and publish a new version.

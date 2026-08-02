import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const E2E_DATABASE_PREFIX = 'roleproof-e2e-';
const E2E_DATABASE_SUFFIXES = new Set(['.db', '.db-journal', '.db-shm', '.db-wal']);
const DEFAULT_MAX_AGE_MS = 3_600_000;

export async function cleanupRoleProofE2EDatabases(options = {}) {
  const directory = options.directory ?? tmpdir();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') {
      return { directory, removed: [], failed: [] };
    }
    throw cause;
  }

  const removed = [];
  const failed = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(E2E_DATABASE_PREFIX)) continue;
    const extension = entry.name.lastIndexOf('.');
    const suffix = extension === -1 ? '' : entry.name.slice(extension);
    if (!E2E_DATABASE_SUFFIXES.has(suffix)) continue;

    const target = join(directory, entry.name);
    try {
      const stats = await stat(target);
      if (Date.now() - stats.mtimeMs < maxAgeMs) continue;
      await rm(target, { force: true });
      removed.push(entry.name);
    } catch (cause) {
      failed.push({
        name: entry.name,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return { directory, removed, failed };
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dir' && argv[index + 1] !== undefined) {
      options.directory = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--age' && argv[index + 1] !== undefined) {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed >= 0) options.maxAgeMs = parsed;
      index += 1;
    }
  }
  return options;
}

const isMainModule =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  const result = await cleanupRoleProofE2EDatabases(parseCliArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.failed.length > 0) process.exitCode = 1;
}

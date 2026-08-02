import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const runAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('../../../scripts/e2e-db-cleanup.mjs', import.meta.url));
const runScriptPath = fileURLToPath(new URL('../../../scripts/run-e2e.mjs', import.meta.url));

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'roleproof-e2e-cleanup-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function runCleanup(directory: string, maxAgeMs: number): Promise<{ removed: string[] }> {
  const { stdout } = await runAsync(
    process.execPath,
    [scriptPath, '--dir', directory, '--age', String(maxAgeMs)],
    { windowsHide: true },
  );
  return JSON.parse(stdout) as { removed: string[] };
}

interface ExecFailure {
  code: number | string | null;
  stdout: string;
  stderr: string;
}

function isExecFailure(value: unknown): value is ExecFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'stdout' in value &&
    'stderr' in value
  );
}

async function runE2EWrapperExpectFailure(directory: string): Promise<ExecFailure> {
  try {
    await runAsync(process.execPath, [runScriptPath], {
      env: {
        ...process.env,
        ROLEPROOF_E2E_CLEANUP_DIR: directory,
        ROLEPROOF_E2E_COMMAND: JSON.stringify([process.execPath, '-e', 'process.exit(7)']),
      },
      windowsHide: true,
    });
  } catch (cause) {
    if (isExecFailure(cause)) return cause;
    throw cause;
  }
  throw new Error('Expected e2e wrapper to preserve the failing test exit code.');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('roleproof e2e database cleanup script', () => {
  it('removes only roleproof e2e database files at the requested age', async () => {
    const directory = await temporaryDirectory();
    await Promise.all([
      writeFile(join(directory, 'roleproof-e2e-1234567890.db'), 'x'),
      writeFile(join(directory, 'roleproof-e2e-1234567890.db-wal'), 'x'),
      writeFile(join(directory, 'roleproof-e2e-1234567890.db-shm'), 'x'),
      writeFile(join(directory, 'roleproof-e2e-1234567890.db-journal'), 'x'),
      writeFile(join(directory, 'unrelated-resume.db'), 'x'),
      writeFile(join(directory, 'roleproof-e2e-notes.txt'), 'x'),
      writeFile(join(directory, 'notes.md'), 'x'),
    ]);

    const result = await runCleanup(directory, 0);

    expect(result.removed.sort()).toEqual([
      'roleproof-e2e-1234567890.db',
      'roleproof-e2e-1234567890.db-journal',
      'roleproof-e2e-1234567890.db-shm',
      'roleproof-e2e-1234567890.db-wal',
    ]);
    await expect(import('node:fs/promises').then((fs) => fs.readdir(directory))).resolves.toEqual([
      'notes.md',
      'roleproof-e2e-notes.txt',
      'unrelated-resume.db',
    ]);
  });

  it('leaves freshly created database files when the maximum age is not reached', async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, 'roleproof-e2e-recent.db'), 'x');

    const result = await runCleanup(directory, 300_000);

    expect(result.removed).toEqual([]);
    await expect(import('node:fs/promises').then((fs) => fs.readdir(directory))).resolves.toEqual([
      'roleproof-e2e-recent.db',
    ]);
  });

  it('treats a missing directory as nothing to clean', async () => {
    const missingDirectory = join(tmpdir(), 'roleproof-e2e-missing-directory');

    const result = await runCleanup(missingDirectory, 0);

    expect(result.removed).toEqual([]);
  });

  it('runs final cleanup even when Playwright fails', async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, 'roleproof-e2e-failing-run.db'), 'x');

    const failure = await runE2EWrapperExpectFailure(directory);

    expect(failure.code).toBe(7);
    await expect(readdir(directory)).resolves.toEqual([]);
  });
});

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

import { cleanupRoleProofE2EDatabases } from './e2e-db-cleanup.mjs';

const DEFAULT_PLAYWRIGHT_COMMAND = ['pnpm', 'exec', 'playwright', 'test'];

function e2eCommand() {
  const override = process.env.ROLEPROOF_E2E_COMMAND;
  if (override === undefined) {
    return { command: DEFAULT_PLAYWRIGHT_COMMAND, useShell: process.platform === 'win32' };
  }
  const parsed = JSON.parse(override);
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
    throw new Error('ROLEPROOF_E2E_COMMAND must be a JSON array of strings.');
  }
  if (parsed.length === 0) throw new Error('ROLEPROOF_E2E_COMMAND must not be empty.');
  return { command: parsed, useShell: false };
}

function run(command, useShell) {
  const [executable, ...args] = command;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: useShell, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal !== null) resolve(1);
      else resolve(code ?? 1);
    });
  });
}

const cleanupDirectory = process.env.ROLEPROOF_E2E_CLEANUP_DIR ?? tmpdir();
let exitCode = 1;

try {
  await cleanupRoleProofE2EDatabases({ directory: cleanupDirectory });
  const command = e2eCommand();
  exitCode = await run(command.command, command.useShell);
} finally {
  const result = await cleanupRoleProofE2EDatabases({
    directory: cleanupDirectory,
    maxAgeMs: 0,
  });
  if (result.failed.length > 0 && exitCode === 0) exitCode = 1;
}

process.exitCode = exitCode;

import { describe, expect, it } from 'vitest';

import { runCli } from '../src/program.js';

async function invoke(args: string[]) {
  let stdout = '';
  let stderr = '';

  const exitCode = await runCli(args, {
    writeOut(message) {
      stdout += message;
    },
    writeErr(message) {
      stderr += message;
    },
  });

  return { exitCode, stderr, stdout };
}

describe('RoleProof CLI program', () => {
  it('prints help to stdout and exits successfully', async () => {
    const result = await invoke(['--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: roleproof [options]');
    expect(result.stdout).toContain('Local-first, evidence-based job-fit analysis');
    expect(result.stdout).toContain('-V, --version');
    expect(result.stdout).toContain('serve');
    expect(result.stderr).toBe('');
  });

  it('prints serve help with the default local URL', async () => {
    const result = await invoke(['serve', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Start the local RoleProof web UI');
    expect(result.stdout).toContain('http://localhost:4173');
    expect(result.stderr).toBe('');
  });

  it('prints only the package version to stdout and exits successfully', async () => {
    const result = await invoke(['--version']);

    expect(result).toEqual({ exitCode: 0, stderr: '', stdout: '0.4.0\n' });
  });

  it('reports an unknown option on stderr with the invalid-arguments exit code', async () => {
    const result = await invoke(['--unknown']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("error: unknown option '--unknown'");
    expect(result.stderr).toContain('Run roleproof --help for usage.');
    expect(result.stderr).not.toContain(' at ');
  });
});

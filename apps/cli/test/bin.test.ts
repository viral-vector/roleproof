import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const cliEntryPath = fileURLToPath(new URL('../bin/roleproof.js', import.meta.url));

function invoke(args: string[]) {
  return spawnSync(process.execPath, [cliEntryPath, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

describe('built roleproof executable', () => {
  it('prints help without writing diagnostics', () => {
    const result = invoke(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: roleproof [options]');
    expect(result.stderr).toBe('');
  });

  it('prints the package version without writing diagnostics', () => {
    const result = invoke(['--version']);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('0.5.0\n');
    expect(result.stderr).toBe('');
  });

  it('uses exit code 2 and stderr for invalid arguments', () => {
    const result = invoke(['--unknown']);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("error: unknown option '--unknown'");
    expect(result.stderr).not.toContain(' at ');
  });
});

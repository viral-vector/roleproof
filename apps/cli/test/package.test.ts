import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

describe('@roleproof/cli package export', () => {
  it('exports reusable program functions without executing the process entry point', () => {
    const script = [
      "import { createProgram, runCli } from '@roleproof/cli';",
      'process.stdout.write(`${typeof createProgram}:${typeof runCli}\\n`);',
    ].join('\n');

    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      windowsHide: true,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('function:function\n');
    expect(result.stderr).toBe('');
  });
});

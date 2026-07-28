import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

  it('builds all workspace artifacts before packing any publishable package', () => {
    const packagePaths = [
      'apps/cli/package.json',
      'packages/core/package.json',
      'packages/parsers/package.json',
      'packages/reporters/package.json',
      'packages/shared/package.json',
    ];

    for (const packagePath of packagePaths) {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
        scripts?: Record<string, string>;
      };
      expect(packageJson.scripts?.prepack, packagePath).toBe('pnpm --dir ../.. build');
    }
  });
});

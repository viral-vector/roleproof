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

  it('declares the provider package as a publishable CLI runtime dependency', () => {
    const cliPackage = JSON.parse(readFileSync('apps/cli/package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const providerPackage = JSON.parse(readFileSync('packages/providers/package.json', 'utf8')) as {
      exports?: Record<string, { default?: string; types?: string }>;
      name?: string;
    };

    expect(cliPackage.dependencies?.['@roleproof/providers']).toBe('workspace:*');
    expect(providerPackage).toMatchObject({
      name: '@roleproof/providers',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    });
  });

  it('builds all workspace artifacts before packing any publishable package', () => {
    const packages: Array<[packagePath: string, directory: string]> = [
      ['apps/cli/package.json', 'apps/cli'],
      ['packages/core/package.json', 'packages/core'],
      ['packages/parsers/package.json', 'packages/parsers'],
      ['packages/providers/package.json', 'packages/providers'],
      ['packages/reporters/package.json', 'packages/reporters'],
      ['packages/shared/package.json', 'packages/shared'],
      ['packages/storage/package.json', 'packages/storage'],
    ];

    const rootLicense = readFileSync('LICENSE', 'utf8');
    for (const [packagePath, directory] of packages) {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
        private?: boolean;
        publishConfig?: { access?: string };
        repository?: { directory?: string; type?: string; url?: string };
        engines?: { node?: string };
        scripts?: Record<string, string>;
        version?: string;
      };
      expect(packageJson.scripts?.prepack, packagePath).toBe('pnpm --dir ../.. build');
      expect(packageJson.version, packagePath).toBe('0.3.0');
      expect(packageJson.private, packagePath).toBe(false);
      expect(packageJson.publishConfig, packagePath).toEqual({ access: 'public' });
      expect(packageJson.engines?.node, packagePath).toBe('>=22.0.0 <25');
      expect(packageJson.repository, packagePath).toEqual({
        type: 'git',
        url: 'https://github.com/viral-vector/roleproof.git',
        directory,
      });
      expect(readFileSync(`${directory}/LICENSE`, 'utf8'), packagePath).toBe(rootLicense);
    }
  });

  it('documents the v0.3.0 release without overstating product outcomes', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8');

    expect(changelog).toContain('## 0.3.0 - 2026-07-30');
    expect(changelog).toContain('optional AI provider');
    expect(changelog).toContain('deterministic');
    expect(changelog).not.toMatch(/interview probability|hiring probability/iu);
  });

  it('forces LF checkout line endings for cross-platform formatting', () => {
    const attributes = readFileSync('.gitattributes', 'utf8');

    expect(attributes).toMatch(/^\* text=auto eol=lf$/mu);
    expect(attributes).toMatch(/^\*\.cmd text eol=crlf$/mu);
    expect(attributes).toMatch(/^\*\.bat text eol=crlf$/mu);
  });
});

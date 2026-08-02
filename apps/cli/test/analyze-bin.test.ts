import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AnalysisEnvelopeSchema } from '@roleproof/shared';
import { createDocx, createPdf } from '@roleproof/test-utils';

const cliEntryPath = fileURLToPath(new URL('../bin/roleproof.js', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('../../../fixtures/phase-1/', import.meta.url));

function invoke(args: string[], cwd?: string) {
  return spawnSync(process.execPath, [cliEntryPath, ...args], {
    ...(cwd === undefined ? {} : { cwd }),
    encoding: 'utf8',
    windowsHide: true,
  });
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

describe('built roleproof analyze executable', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'roleproof cli pdf-'));
  });

  afterAll(async () => {
    await rm(directory, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 });
  });

  it(
    'emits pure JSON and readable Markdown from fictional text fixtures',
    () => {
      const resumePath = join(fixtureRoot, 'strong-match', 'resume.txt');
      const jobPath = join(fixtureRoot, 'strong-match', 'job.txt');
      const jsonResult = invoke([
        'analyze',
        '--resume',
        resumePath,
        '--job',
        jobPath,
        '--no-ai',
        '--no-store',
        '--format',
        'json',
        '--stdout',
      ]);
      const markdownResult = invoke([
        'analyze',
        '--resume',
        resumePath,
        '--job',
        jobPath,
        '--no-ai',
        '--no-store',
        '--format',
        'markdown',
        '--stdout',
      ]);

      expect(jsonResult.status).toBe(0);
      expect(jsonResult.stderr).toBe('');
      expect(() => AnalysisEnvelopeSchema.parse(parseJson(jsonResult.stdout))).not.toThrow();
      expect(markdownResult.status).toBe(0);
      expect(markdownResult.stderr).toBe('');
      expect(markdownResult.stdout).toContain('# RoleProof Analysis');
    },
    120_000,
  );

  it(
    'produces stable normalized JSON across repeated executable runs',
    () => {
      const args = [
        'analyze',
        '--resume',
        join(fixtureRoot, 'strong-match', 'resume.txt'),
        '--job',
        join(fixtureRoot, 'strong-match', 'job.txt'),
        '--no-ai',
        '--no-store',
        '--format',
        'json',
        '--stdout',
      ];
      const first = AnalysisEnvelopeSchema.parse(parseJson(invoke(args).stdout));
      const second = AnalysisEnvelopeSchema.parse(parseJson(invoke(args).stdout));

      expect({ ...second.analysis, generatedAt: 'ignored' }).toEqual({
        ...first.analysis,
        generatedAt: 'ignored',
      });
    },
    120_000,
  );

  it('writes both formats to the working directory when out is omitted', async () => {
    const outputDirectory = join(directory, 'default reports');
    await mkdir(outputDirectory);
    const result = invoke(
      [
        'analyze',
        '--resume',
        join(fixtureRoot, 'strong-match', 'resume.txt'),
        '--job',
        join(fixtureRoot, 'strong-match', 'job.txt'),
        '--no-ai',
        '--no-store',
        '--format',
        'both',
      ],
      outputDirectory,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    await expect(
      readFile(join(outputDirectory, 'roleproof-analysis.json'), 'utf8'),
    ).resolves.toContain('"schemaVersion": "1.0"');
    await expect(
      readFile(join(outputDirectory, 'roleproof-analysis.md'), 'utf8'),
    ).resolves.toContain('# RoleProof Analysis');
  });

  it('runs PDF extraction through the deterministic core', async () => {
    const resumePath = join(directory, 'fictional resume.pdf');
    await writeFile(
      resumePath,
      createPdf(['TypeScript Node.js PostgreSQL OAuth2 REST API Team leadership']),
    );
    const result = invoke([
      'analyze',
      '--resume',
      resumePath,
      '--job',
      join(fixtureRoot, 'strong-match', 'job.txt'),
      '--no-ai',
      '--no-store',
      '--format',
      'json',
      '--stdout',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const output = AnalysisEnvelopeSchema.parse(parseJson(result.stdout));
    expect(output.analysis.resumeDocumentId).toMatch(/^resume-/u);
  });

  it('runs DOCX extraction through the deterministic core', async () => {
    const resumePath = join(directory, 'fictional resume.docx');
    await writeFile(
      resumePath,
      createDocx([
        'Fictional Candidate',
        'Experience: Built production TypeScript APIs with Node.js and PostgreSQL.',
      ]),
    );
    const result = invoke([
      'analyze',
      '--resume',
      resumePath,
      '--job',
      join(fixtureRoot, 'strong-match', 'job.txt'),
      '--no-ai',
      '--no-store',
      '--format',
      'json',
      '--stdout',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const output = AnalysisEnvelopeSchema.parse(parseJson(result.stdout));
    expect(output.analysis.resumeDocumentId).toMatch(/^resume-/u);
    expect(output.analysis.matchedRequirements.length).toBeGreaterThan(0);
  });

  it('preserves parsing and hard-blocker exit codes', async () => {
    const missingPath = join(directory, 'missing.txt');
    const parseResult = invoke([
      'analyze',
      '--resume',
      missingPath,
      '--job',
      join(fixtureRoot, 'strong-match', 'job.txt'),
      '--no-ai',
      '--no-store',
      '--format',
      'json',
      '--stdout',
    ]);
    const blockerResult = invoke([
      'analyze',
      '--resume',
      join(fixtureRoot, 'compensation-blocker', 'resume.txt'),
      '--job',
      join(fixtureRoot, 'compensation-blocker', 'job.txt'),
      '--no-ai',
      '--no-store',
      '--format',
      'json',
      '--stdout',
      '--target-salary-min',
      '120000',
    ]);

    expect(parseResult.status).toBe(3);
    expect(parseResult.stdout).toBe('');
    expect(parseResult.stderr).toContain(missingPath);
    expect(blockerResult.status).toBe(10);
    expect(blockerResult.stderr).toBe('');
    expect(() => AnalysisEnvelopeSchema.parse(parseJson(blockerResult.stdout))).not.toThrow();

    // Keep the fixture read in this process so this test also catches path portability issues.
    await expect(
      readFile(join(fixtureRoot, 'compensation-blocker', 'job.txt'), 'utf8'),
    ).resolves.toContain('USD');
  });
});

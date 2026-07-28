import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AnalysisEnvelopeSchema } from '@roleproof/shared';

import { runCli } from '../src/program.js';

const resumeText = `
Avery Morgan
Location: Remote
Work authorization: Authorized without sponsorship

Skills: TypeScript, Node.js, PostgreSQL, Docker, OAuth2

Experience
2020-2026: Built backend REST APIs with TypeScript, Node.js, and PostgreSQL.
Led a fictional engineering team and delivered services with Docker on AWS.
`;

const jobText = `
Backend Engineer

Required Qualifications
- TypeScript and Node.js backend experience
- PostgreSQL
- OAuth2
- REST API development

Preferred Qualifications
- Kubernetes

Location: Remote
Salary: USD 120000-150000 annually
`;

interface InvocationResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

async function invoke(args: string[]): Promise<InvocationResult> {
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

describe('roleproof analyze', () => {
  let directory: string;
  let resumePath: string;
  let jobPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'roleproof phase 1-'));
    resumePath = join(directory, 'fictional resume.txt');
    jobPath = join(directory, 'fictional job.txt');
    await Promise.all([
      writeFile(resumePath, resumeText, 'utf8'),
      writeFile(jobPath, jobText, 'utf8'),
    ]);
  });

  afterEach(async () => {
    await rm(directory, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 });
  });

  it('prints schema-versioned JSON only to stdout for paths with spaces', async () => {
    const result = await invoke([
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

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const output = AnalysisEnvelopeSchema.parse(parseJson(result.stdout));
    expect(output.schemaVersion).toBe('1.0');
    expect(['apply', 'stretch', 'skip', 'manual-review']).toContain(output.analysis.recommendation);
    expect(output.analysis.scoreContributions).toBeInstanceOf(Array);
  });

  it('prints the required Markdown report sections', async () => {
    const result = await invoke([
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--no-ai',
      '--format',
      'markdown',
      '--stdout',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('# RoleProof Analysis');
    expect(result.stdout).toContain('## Recommendation');
    expect(result.stdout).toContain('## Eligibility');
    expect(result.stdout).toContain('## Strong Matches');
    expect(result.stdout).toContain('## Missing Requirements');
    expect(result.stdout).not.toMatch(/interview probability|hiring probability/i);
  });

  it('writes both report files without polluting stdout', async () => {
    const outputDirectory = join(directory, 'reports');
    const result = await invoke([
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--no-ai',
      '--format',
      'both',
      '--out',
      outputDirectory,
    ]);

    expect(result).toEqual({ exitCode: 0, stderr: '', stdout: '' });
    const [json, markdown] = await Promise.all([
      readFile(join(outputDirectory, 'roleproof-analysis.json'), 'utf8'),
      readFile(join(outputDirectory, 'roleproof-analysis.md'), 'utf8'),
    ]);
    expect(() => AnalysisEnvelopeSchema.parse(parseJson(json))).not.toThrow();
    expect(markdown).toContain('# RoleProof Analysis');
  });

  it('rejects both formats on stdout as invalid arguments', async () => {
    const result = await invoke([
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--no-ai',
      '--format',
      'both',
      '--stdout',
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('cannot be written together to stdout');
  });

  it('returns parsing exit code 3 without echoing private file contents', async () => {
    const missingPath = join(directory, 'missing resume.txt');
    const result = await invoke([
      'analyze',
      '--resume',
      missingPath,
      '--job',
      jobPath,
      '--no-ai',
      '--format',
      'json',
      '--stdout',
    ]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(missingPath);
    expect(result.stderr).not.toContain('Avery Morgan');
  });

  it('returns exit code 10 while preserving valid JSON for a compensation blocker', async () => {
    await writeFile(jobPath, jobText.replace('USD 120000-150000', 'USD 80000-100000'), 'utf8');

    const result = await invoke([
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--no-ai',
      '--format',
      'json',
      '--stdout',
      '--target-salary-min',
      '120000',
    ]);

    expect(result.exitCode).toBe(10);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout) as {
      analysis: { hardBlockers: string[]; recommendation: string };
    };
    expect(output.analysis.recommendation).toBe('skip');
    expect(output.analysis.hardBlockers).toEqual([expect.stringContaining('Compensation maximum')]);
  });
});

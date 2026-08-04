import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalysisEnvelopeSchema, BatchEnvelopeSchema } from '@roleproof/shared';
import { closeStorage, createRoleProofRepositories, openStorage } from '@roleproof/storage';

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

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function invoke(args: string[], stdinContent?: string): Promise<InvocationResult> {
  let stdout = '';
  let stderr = '';
  const stdin = stdinContent === undefined ? process.stdin : Readable.from([stdinContent]);
  const exitCode = await runCli(
    args,
    {
      writeOut(message) {
        stdout += message;
      },
      writeErr(message) {
        stderr += message;
      },
    },
    stdin,
  );

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

  it('supports job URLs and includes job source metadata in JSON output', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          '<html><body><h1>Backend Engineer</h1><p>TypeScript</p><p>Node.js</p></body></html>',
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        ),
      );
    vi.stubGlobal('fetch', fetchImpl as typeof fetch);

    const result = await invoke([
      'analyze',
      '--resume',
      resumePath,
      '--job',
      'https://boards.greenhouse.io/fictionalco/jobs/123',
      '--no-ai',
      '--no-store',
      '--format',
      'json',
      '--stdout',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const output = AnalysisEnvelopeSchema.parse(parseJson(result.stdout));
    expect(output.analysis.metadata.jobSource?.sourceClassification).toBe('official-ats');
    expect(output.analysis.metadata.jobSource?.atsProvider).toBe('greenhouse');
    expect(output.analysis.metadata.jobSource?.url).toBe(
      'https://boards.greenhouse.io/fictionalco/jobs/123',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('prints the required Markdown report sections', async () => {
    const result = await invoke([
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
      '--no-store',
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
      '--no-store',
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
      '--no-store',
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
      '--no-store',
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

  it('persists the default profile, active resume evidence, job requirements, and report', async () => {
    const databasePath = join(directory, 'custom roleproof.db');
    const result = await invoke([
      '--db',
      databasePath,
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--no-ai',
      '--format',
      'json',
      '--stdout',
    ]);

    expect(result).toMatchObject({ exitCode: 0, stderr: '' });
    const output = AnalysisEnvelopeSchema.parse(parseJson(result.stdout));
    const database = await openStorage({ path: databasePath });
    try {
      const repositories = createRoleProofRepositories(database);
      expect(await repositories.profiles.get('profile-local')).toBeDefined();
      expect(await repositories.documents.get(output.analysis.resumeDocumentId!)).toBeDefined();
      expect(
        await repositories.evidence.listByDocument(output.analysis.resumeDocumentId!),
      ).not.toEqual([]);
      expect(await repositories.jobs.get(output.analysis.jobId!)).toBeDefined();
      expect(await repositories.jobs.getRequirements(output.analysis.jobId!)).not.toEqual([]);
      const stored = await repositories.analyses.get(output.analysis.id);
      expect(stored?.report).toContain('# RoleProof Analysis');
      expect(stored?.evidenceReferences.length).toBeGreaterThan(0);
    } finally {
      await closeStorage(database);
    }
  });

  it('does not create a database or parent directory in unprofiled no-store mode', async () => {
    const databasePath = join(directory, 'must-not-exist', 'roleproof.db');
    const result = await invoke([
      '--db',
      databasePath,
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

    expect(result).toMatchObject({ exitCode: 0, stderr: '' });
    await expect(access(join(directory, 'must-not-exist'))).rejects.toThrow();
  });

  it('persists blocker analyses before returning exit code 10', async () => {
    const databasePath = join(directory, 'blocker.db');
    await writeFile(jobPath, jobText.replace('USD 120000-150000', 'USD 80000-100000'), 'utf8');
    const result = await invoke([
      '--db',
      databasePath,
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
    const output = AnalysisEnvelopeSchema.parse(parseJson(result.stdout));

    expect(result.exitCode).toBe(10);
    const database = await openStorage({ path: databasePath });
    try {
      expect(
        (await createRoleProofRepositories(database).analyses.get(output.analysis.id))?.result
          .hardBlockers,
      ).not.toEqual([]);
    } finally {
      await closeStorage(database);
    }
  });

  it('reuses records across identical persisted runs', async () => {
    const databasePath = join(directory, 'repeat.db');
    const args = [
      '--db',
      databasePath,
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--no-ai',
      '--format',
      'json',
      '--stdout',
    ];
    const first = await invoke(args);
    const second = await invoke(args);

    expect(first).toMatchObject({ exitCode: 0, stderr: '' });
    expect(second).toMatchObject({ exitCode: 0, stderr: '' });
    const firstOutput = AnalysisEnvelopeSchema.parse(parseJson(first.stdout));
    const secondOutput = AnalysisEnvelopeSchema.parse(parseJson(second.stdout));
    expect({ ...secondOutput.analysis, generatedAt: 'ignored' }).toEqual({
      ...firstOutput.analysis,
      generatedAt: 'ignored',
    });
    const database = await openStorage({ path: databasePath });
    try {
      const repositories = createRoleProofRepositories(database);
      expect(await repositories.documents.listByProfile('profile-local')).toHaveLength(1);
      expect(await repositories.analyses.listHistory()).toHaveLength(1);
      const jobs = await database
        .selectFrom('jobs')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow();
      expect(jobs.count).toBe(1);
    } finally {
      await closeStorage(database);
    }
  });

  it('requires an available database for profile no-store mode without creating it', async () => {
    const databasePath = join(directory, 'missing', 'roleproof.db');
    const result = await invoke([
      '--db',
      databasePath,
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--profile',
      'profile-missing',
      '--no-ai',
      '--no-store',
      '--format',
      'json',
      '--stdout',
    ]);

    expect(result).toMatchObject({ exitCode: 5, stdout: '' });
    expect(result.stderr).toContain('Storage operation failed');
    await expect(access(join(directory, 'missing'))).rejects.toThrow();
  });

  it('uses selected profile evidence read-only and keeps cited IDs resolvable', async () => {
    const databasePath = join(directory, 'profile-read-only.db');
    const database = await openStorage({ path: databasePath });
    try {
      const repositories = createRoleProofRepositories(database);
      await repositories.profiles.create({
        id: 'profile-selected',
        name: 'Selected fictional profile',
        targetTitles: [],
        preferredLocations: [],
      });
      const text = 'User-confirmed Kubernetes platform work.';
      await repositories.documents.insert(
        {
          schemaVersion: '1.0',
          id: 'document-profile-note',
          profileId: 'profile-selected',
          kind: 'evidence-note',
          format: 'plaintext',
          contentSha256: hash(text),
          parsedContentSha256: hash(text),
          text,
          confidence: 1,
          warnings: [],
        },
        [
          {
            id: 'evidence-profile-kubernetes',
            profileId: 'profile-selected',
            category: 'skill',
            name: 'Kubernetes',
            normalizedName: 'kubernetes',
            description: text,
            sourceDocumentId: 'document-profile-note',
            sourceText: text,
            confidence: 'user-confirmed',
          },
        ],
      );
    } finally {
      await closeStorage(database);
    }
    await writeFile(jobPath, 'Required Qualifications\n- Kubernetes is required', 'utf8');
    const filesBefore = (await readdir(directory)).sort();

    const result = await invoke([
      '--db',
      databasePath,
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--profile',
      'profile-selected',
      '--no-ai',
      '--no-store',
      '--format',
      'json',
      '--stdout',
    ]);

    expect(result).toMatchObject({ exitCode: 0, stderr: '' });
    const output = AnalysisEnvelopeSchema.parse(parseJson(result.stdout));
    expect(output.analysis.matchedRequirements).toEqual([
      expect.objectContaining({ evidenceIds: ['evidence-profile-kubernetes'], score: 1 }),
    ]);
    expect(
      (await readdir(directory))
        .filter(
          (name) => name !== 'profile-read-only.db-wal' && name !== 'profile-read-only.db-shm',
        )
        .sort(),
    ).toEqual(filesBefore);
    const readDatabase = await openStorage({ path: databasePath, readOnly: true });
    try {
      const repositories = createRoleProofRepositories(readDatabase);
      expect(await repositories.evidence.get('evidence-profile-kubernetes')).toBeDefined();
      expect(await repositories.analyses.listHistory()).toEqual([]);
    } finally {
      await closeStorage(readDatabase);
    }
  });

  it('preserves user edits when a duplicate resume is analyzed again', async () => {
    const databasePath = join(directory, 'duplicate-edit.db');
    const first = await invoke([
      '--db',
      databasePath,
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--no-ai',
      '--format',
      'json',
      '--stdout',
    ]);
    expect(first.exitCode).toBe(0);
    const firstOutput = AnalysisEnvelopeSchema.parse(parseJson(first.stdout));
    const database = await openStorage({ path: databasePath });
    let editedId: string;
    try {
      const repositories = createRoleProofRepositories(database);
      const evidence = await repositories.evidence.listByDocument(
        firstOutput.analysis.resumeDocumentId!,
      );
      const extracted = evidence[0];
      if (extracted === undefined) throw new Error('Expected extracted resume evidence');
      editedId = extracted.id;
      await repositories.evidence.edit(extracted.id, {
        name: 'Kubernetes',
        normalizedName: 'kubernetes',
        description: 'User-confirmed correction to Kubernetes.',
      });
    } finally {
      await closeStorage(database);
    }
    await writeFile(jobPath, 'Required Qualifications\n- Kubernetes is required', 'utf8');

    const second = await invoke([
      '--db',
      databasePath,
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--profile',
      'profile-local',
      '--no-ai',
      '--format',
      'json',
      '--stdout',
    ]);

    expect(second).toMatchObject({ exitCode: 0, stderr: '' });
    const secondOutput = AnalysisEnvelopeSchema.parse(parseJson(second.stdout));
    expect(secondOutput.analysis.resumeDocumentId).toBe(firstOutput.analysis.resumeDocumentId);
    expect(secondOutput.analysis.matchedRequirements[0]?.evidenceIds).toContain(editedId!);
    const checkDatabase = await openStorage({ path: databasePath });
    try {
      const repositories = createRoleProofRepositories(checkDatabase);
      expect(await repositories.documents.listByProfile('profile-local')).toHaveLength(1);
      expect((await repositories.evidence.get(editedId!))?.description).toBe(
        'User-confirmed correction to Kubernetes.',
      );
    } finally {
      await closeStorage(checkDatabase);
    }
  });

  it('awards zero points for inferred selected-profile evidence', async () => {
    const databasePath = join(directory, 'inferred-profile.db');
    const database = await openStorage({ path: databasePath });
    try {
      const repositories = createRoleProofRepositories(database);
      await repositories.profiles.create({
        id: 'profile-inferred',
        targetTitles: [],
        preferredLocations: [],
      });
      const text = 'Unconfirmed Kubernetes inference.';
      await repositories.documents.insert(
        {
          schemaVersion: '1.0',
          id: 'document-inferred',
          profileId: 'profile-inferred',
          kind: 'evidence-note',
          format: 'plaintext',
          contentSha256: hash(text),
          parsedContentSha256: hash(text),
          text,
          confidence: 0.5,
          warnings: [],
        },
        [
          {
            id: 'evidence-inferred-kubernetes',
            profileId: 'profile-inferred',
            category: 'skill',
            name: 'Kubernetes',
            normalizedName: 'kubernetes',
            description: text,
            sourceDocumentId: 'document-inferred',
            sourceText: text,
            confidence: 'inferred',
          },
        ],
      );
    } finally {
      await closeStorage(database);
    }
    await writeFile(jobPath, 'Required Qualifications\n- Kubernetes is required', 'utf8');

    const result = await invoke([
      '--db',
      databasePath,
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--profile',
      'profile-inferred',
      '--no-ai',
      '--no-store',
      '--format',
      'json',
      '--stdout',
    ]);

    expect(result).toMatchObject({ exitCode: 0, stderr: '' });
    const output = AnalysisEnvelopeSchema.parse(parseJson(result.stdout));
    expect(output.analysis.matchedRequirements).toEqual([
      expect.objectContaining({
        classification: 'requires-user-confirmation',
        evidenceIds: ['evidence-inferred-kubernetes'],
        score: 0,
      }),
    ]);
    expect(output.analysis.scoreContributions).toEqual([
      expect.objectContaining({
        evidenceIds: ['evidence-inferred-kubernetes'],
        pointsAwarded: 0,
      }),
    ]);
  });
});

describe('roleproof analyze stdin inputs', () => {
  let directory: string;
  let resumePath: string;
  let jobPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'roleproof phase 6 stdin-'));
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

  const baselineArgs = (rPath: string, jPath: string): string[] => [
    'analyze',
    '--resume',
    rPath,
    '--job',
    jPath,
    '--no-ai',
    '--no-store',
    '--format',
    'json',
    '--stdout',
  ];

  function analysisWithoutTimestamp(stdout: string): Record<string, unknown> {
    const analysis = AnalysisEnvelopeSchema.parse(parseJson(stdout)).analysis;
    const copy: Record<string, unknown> = { ...analysis };
    delete copy.generatedAt;
    return copy;
  }

  it('reads the job description from stdin with --stdin-job', async () => {
    const baseline = await invoke(baselineArgs(resumePath, jobPath));
    expect(baseline.exitCode).toBe(0);
    expect(baseline.stderr).toBe('');

    const result = await invoke(
      [
        'analyze',
        '--resume',
        resumePath,
        '--stdin-job',
        '--no-ai',
        '--no-store',
        '--format',
        'json',
        '--stdout',
      ],
      jobText,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(analysisWithoutTimestamp(result.stdout)).toEqual(
      analysisWithoutTimestamp(baseline.stdout),
    );
  });

  it('reads the resume from stdin with --stdin-resume', async () => {
    const baseline = await invoke(baselineArgs(resumePath, jobPath));
    expect(baseline.exitCode).toBe(0);
    expect(baseline.stderr).toBe('');

    const result = await invoke(
      [
        'analyze',
        '--stdin-resume',
        '--job',
        jobPath,
        '--no-ai',
        '--no-store',
        '--format',
        'json',
        '--stdout',
      ],
      resumeText,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(analysisWithoutTimestamp(result.stdout)).toEqual(
      analysisWithoutTimestamp(baseline.stdout),
    );
  });

  it('rejects --stdin-resume combined with --resume', async () => {
    const result = await invoke(
      [
        'analyze',
        '--resume',
        resumePath,
        '--stdin-resume',
        '--job',
        jobPath,
        '--no-ai',
        '--no-store',
      ],
      resumeText,
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/resume/i);
  });

  it('rejects --stdin-job combined with --job', async () => {
    const result = await invoke(
      ['analyze', '--resume', resumePath, '--job', jobPath, '--stdin-job', '--no-ai', '--no-store'],
      jobText,
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/job/i);
  });

  it('rejects both --stdin-resume and --stdin-job', async () => {
    const result = await invoke(
      ['analyze', '--stdin-resume', '--stdin-job', '--no-ai', '--no-store'],
      'Skills: TypeScript\nBackend Engineer\n',
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/stdin/i);
  });

  it('requires a resume source when neither --resume nor --stdin-resume is given', async () => {
    const result = await invoke(['analyze', '--job', jobPath, '--no-ai', '--no-store']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/resume/i);
  });

  it('fails cleanly with exit code 3 when a file input is missing and stdin supplies the other input', async () => {
    const result = await invoke(
      [
        'analyze',
        '--stdin-job',
        '--resume',
        join(directory, 'missing resume.txt'),
        '--no-ai',
        '--no-store',
        '--format',
        'json',
        '--stdout',
      ],
      jobText,
    );

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/resume/i);
  });

  it('rejects stdin content that exceeds the plaintext size limit', async () => {
    const result = await invoke(
      [
        'analyze',
        '--stdin-resume',
        '--job',
        jobPath,
        '--no-ai',
        '--no-store',
        '--format',
        'json',
        '--stdout',
      ],
      `Skills: TypeScript\n${'x'.repeat(2_000_000)}\n`,
    );

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/limit/i);
  });

  it('rejects empty stdin content', async () => {
    const result = await invoke(
      [
        'analyze',
        '--stdin-resume',
        '--job',
        jobPath,
        '--no-ai',
        '--no-store',
        '--format',
        'json',
        '--stdout',
      ],
      '',
    );

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/no readable text/i);
  });
});

describe('roleproof analyze batch', () => {
  let directory: string;
  let manifestDirectory: string;
  let manifestPath: string;
  let resumePath: string;
  let jobPath: string;
  let otherResumePath: string;
  let otherJobPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'roleproof batch-'));
    manifestDirectory = join(directory, 'manifests');
    await mkdir(manifestDirectory, { recursive: true });
    manifestPath = join(manifestDirectory, 'batch.json');
    resumePath = join(directory, 'resume.txt');
    jobPath = join(directory, 'job.txt');
    otherResumePath = join(directory, 'other resume.txt');
    otherJobPath = join(directory, 'other job.txt');
    await Promise.all([
      writeFile(resumePath, resumeText, 'utf8'),
      writeFile(jobPath, jobText, 'utf8'),
      writeFile(otherResumePath, `${resumeText}\nAdditional fictional project.\n`, 'utf8'),
      writeFile(otherJobPath, `${jobText}\n- Python\n`, 'utf8'),
    ]);
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: '1.0',
        pairs: [
          { resume: '../resume.txt', job: '../job.txt' },
          { resume: '../other resume.txt', job: '../other job.txt' },
        ],
      }),
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(directory, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 });
  });

  it('analyzes every manifest pair in order and returns a batch envelope', async () => {
    const result = await invoke([
      'analyze',
      '--manifest',
      manifestPath,
      '--no-ai',
      '--no-store',
      '--format',
      'json',
      '--stdout',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const envelope = BatchEnvelopeSchema.parse(parseJson(result.stdout));
    expect(envelope.schemaVersion).toBe('1.0');
    const [firstPair, secondPair] = envelope.pairs;
    expect(firstPair).toBeDefined();
    expect(secondPair).toBeDefined();
    if (firstPair?.status === 'completed' && secondPair?.status === 'completed') {
      expect(firstPair.analysis.resumeDocumentId).not.toBe(secondPair.analysis.resumeDocumentId);
    }
  });

  it('produces identical envelopes for identical manifests across runs', async () => {
    const run = async () =>
      (
        await invoke([
          'analyze',
          '--manifest',
          manifestPath,
          '--no-ai',
          '--no-store',
          '--format',
          'json',
          '--stdout',
        ])
      ).stdout;
    const first = parseJson(await run()) as {
      pairs: Array<{ analysis?: { generatedAt: string } }>;
    };
    const second = parseJson(await run()) as {
      pairs: Array<{ analysis?: { generatedAt: string } }>;
    };
    const strip = (envelope: typeof first) =>
      envelope.pairs.map((pair) =>
        pair.analysis === undefined
          ? pair
          : { ...pair, analysis: { ...pair.analysis, generatedAt: undefined } },
      );
    expect(strip(first)).toEqual(strip(second));
  });

  it('rejects --manifest combined with --resume', async () => {
    const result = await invoke([
      'analyze',
      '--manifest',
      manifestPath,
      '--resume',
      resumePath,
      '--no-ai',
      '--no-store',
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/manifest/i);
  });

  it('rejects --manifest combined with --stdin-job', async () => {
    const result = await invoke(
      ['analyze', '--manifest', manifestPath, '--stdin-job', '--no-ai', '--no-store'],
      jobText,
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/manifest/i);
  });

  it('rejects --manifest combined with provider options', async () => {
    const result = await invoke([
      'analyze',
      '--manifest',
      manifestPath,
      '--provider',
      'openai',
      '--model',
      'gpt-4o-mini',
      '--no-ai',
      '--no-store',
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/provider/i);
  });

  it('rejects --manifest combined with --model alone (no --provider)', async () => {
    const result = await invoke([
      'analyze',
      '--manifest',
      manifestPath,
      '--model',
      'gpt-4o-mini',
      '--no-ai',
      '--no-store',
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/model/i);
  });

  it('accepts a manifest saved with a UTF-8 byte order mark', async () => {
    await writeFile(
      manifestPath,
      `\uFEFF${JSON.stringify({
        schemaVersion: '1.0',
        pairs: [{ resume: '../resume.txt', job: '../job.txt' }],
      })}`,
      'utf8',
    );
    const result = await invoke([
      'analyze',
      '--manifest',
      manifestPath,
      '--no-ai',
      '--no-store',
      '--format',
      'json',
      '--stdout',
    ]);

    expect(result.exitCode).toBe(0);
    expect(BatchEnvelopeSchema.parse(parseJson(result.stdout)).pairs).toHaveLength(1);
  });

  it('rejects a manifest whose content is not valid JSON', async () => {
    await writeFile(manifestPath, 'not json {', 'utf8');
    const result = await invoke(['analyze', '--manifest', manifestPath, '--no-ai', '--no-store']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/manifest/i);
  });

  it('rejects a manifest that violates the schema', async () => {
    await writeFile(
      manifestPath,
      JSON.stringify({ schemaVersion: '1.0', pairs: [{ resume: '   ', job: 'job.txt' }] }),
      'utf8',
    );
    const result = await invoke(['analyze', '--manifest', manifestPath, '--no-ai', '--no-store']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/manifest/i);
  });

  it('rejects an empty pairs manifest', async () => {
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: '1.0', pairs: [] }), 'utf8');
    const result = await invoke(['analyze', '--manifest', manifestPath, '--no-ai', '--no-store']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/pair/i);
  });

  it('fails with exit code 3 when a manifest file is missing', async () => {
    const result = await invoke([
      'analyze',
      '--manifest',
      join(directory, 'missing manifest.json'),
      '--no-ai',
      '--no-store',
    ]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/manifest/i);
  });

  it('records a failed pair and still completes the remaining pairs', async () => {
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: '1.0',
        pairs: [
          { resume: '../resume.txt', job: '../job.txt' },
          { resume: '../missing resume.txt', job: '../job.txt' },
          { resume: '../other resume.txt', job: '../other job.txt' },
        ],
      }),
      'utf8',
    );
    const result = await invoke([
      'analyze',
      '--manifest',
      manifestPath,
      '--no-ai',
      '--no-store',
      '--format',
      'json',
      '--stdout',
    ]);

    expect(result.exitCode).toBe(3);
    const envelope = BatchEnvelopeSchema.parse(parseJson(result.stdout));
    expect(envelope.pairs.map((pair) => pair.status)).toEqual(['completed', 'failed', 'completed']);
    const failedPair = envelope.pairs[1];
    if (failedPair?.status === 'failed') {
      expect(failedPair.code).toBe(3);
    }
  });

  it('rejects --concurrency outside the supported range', async () => {
    for (const concurrency of ['0', '999']) {
      const result = await invoke([
        'analyze',
        '--manifest',
        manifestPath,
        '--concurrency',
        concurrency,
        '--no-ai',
        '--no-store',
      ]);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/concurrency/i);
    }
  });

  it('accepts --concurrency within the supported range', async () => {
    const result = await invoke([
      'analyze',
      '--manifest',
      manifestPath,
      '--concurrency',
      '2',
      '--no-ai',
      '--no-store',
      '--format',
      'json',
      '--stdout',
    ]);

    expect(result.exitCode).toBe(0);
    const envelope = BatchEnvelopeSchema.parse(parseJson(result.stdout));
    expect(envelope.pairs.every((pair) => pair.status === 'completed')).toBe(true);
  });

  it('stores every analysis when storage is enabled', async () => {
    const databaseFile = join(directory, 'batch.db');
    const result = await invoke([
      'analyze',
      '--manifest',
      manifestPath,
      '--no-ai',
      '--db',
      databaseFile,
      '--format',
      'json',
      '--stdout',
    ]);

    expect(result.exitCode).toBe(0);
    const envelope = BatchEnvelopeSchema.parse(parseJson(result.stdout));
    expect(envelope.pairs.every((pair) => pair.status === 'completed')).toBe(true);
    const database = await openStorage({ path: databaseFile });
    try {
      const repositories = createRoleProofRepositories(database);
      expect((await repositories.analyses.listHistory(undefined)).length).toBe(2);
    } finally {
      await closeStorage(database);
    }
  });

  it('writes per-pair reports to --out and keeps JSON stdout pure', async () => {
    const outDirectory = join(directory, 'reports');
    const result = await invoke([
      'analyze',
      '--manifest',
      manifestPath,
      '--no-ai',
      '--no-store',
      '--out',
      outDirectory,
      '--format',
      'both',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    const files = (await readdir(outDirectory)).sort();
    expect(files).toContain('roleproof-batch.json');
    expect(files).toContain('roleproof-batch.md');
    expect(files).toContain('roleproof-batch-pair-1.md');
    expect(files).toContain('roleproof-batch-pair-1.json');
    expect(files).toContain('roleproof-batch-pair-2.md');
    expect(files).toContain('roleproof-batch-pair-2.json');
    const batchJson = await readFile(join(outDirectory, 'roleproof-batch.json'), 'utf8');
    expect(BatchEnvelopeSchema.parse(JSON.parse(batchJson)).pairs).toHaveLength(2);
  });
});

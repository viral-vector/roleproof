import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  AnalysisHistoryItemSchema,
  AnalysisResultSchema,
  EvidenceReferenceSchema,
  JobRequirementSchema,
  SearchResultSchema,
  StoredJobSchema,
  type AnalysisResult,
  type EvidenceReference,
  type JobRequirement,
} from '@roleproof/shared';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import {
  closeStorage,
  createRoleProofRepositories,
  openStorage,
  purgeStorage,
  rebuildSearchIndexes,
  StorageError,
  type StorageDatabase,
} from '../src/index.js';

const directories: string[] = [];
const databases: StorageDatabase[] = [];
const now = '2026-07-01T12:00:00.000Z';

async function temporaryPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'roleproof-remaining-storage-'));
  directories.push(directory);
  return resolve(directory, 'roleproof.db');
}

async function temporaryStorage() {
  const path = await temporaryPath();
  const database = await openStorage({ path });
  databases.push(database);
  return { database, path };
}

function job(id: string, hashCharacter: string, text = 'Cobalt platform engineering role') {
  return {
    schemaVersion: '1.0' as const,
    id,
    format: 'plaintext' as const,
    contentSha256: hashCharacter.repeat(64),
    parsedContentSha256: hashCharacter.repeat(64),
    text,
    confidence: 1,
    warnings: [],
  };
}

function requirement(id: string, text = 'TypeScript is required'): JobRequirement {
  return {
    id,
    category: 'language',
    text,
    normalizedName: 'typescript',
    importance: 'required',
    yearsRequested: 2,
  };
}

function analysis(id: string, jobId?: string): AnalysisResult {
  return AnalysisResultSchema.parse({
    schemaVersion: '1.0',
    id,
    profileId: 'profile-1',
    resumeDocumentId: 'document-1',
    ...(jobId === undefined ? {} : { jobId }),
    overallScore: 75,
    recommendation: 'stretch',
    confidence: 0.9,
    hardBlockers: [],
    matchedRequirements: [],
    missingRequirements: [],
    unsupportedClaims: [],
    suggestedEmphasis: [],
    suggestedAdditions: [],
    interviewTopics: ['Discuss fictional platform work'],
    generatedAt: now,
    metadata: { mode: 'deterministic', engineVersion: 'test-engine' },
  });
}

function analysisCitingEvidence(id: string): AnalysisResult {
  return AnalysisResultSchema.parse({
    ...analysis(id),
    matchedRequirements: [
      {
        requirementId: 'requirement-1',
        evidenceIds: ['evidence-1'],
        classification: 'direct',
        score: 1,
        explanation: 'Supported by canonical fictional evidence.',
      },
    ],
  });
}

function reference(sourceText = 'Original fictional evidence'): EvidenceReference {
  return EvidenceReferenceSchema.parse({
    evidenceId: 'evidence-1',
    sourceType: 'career-evidence',
    sourceId: 'evidence-1',
    sourceDocumentId: 'document-1',
    sourceText,
    confidence: 'explicit',
  });
}

async function seedProfileAndDocument(database: StorageDatabase): Promise<void> {
  await sql`insert into profiles (
    id, target_titles_json, preferred_locations_json, created_at, updated_at
  ) values ('profile-1', '[]', '[]', ${now}, ${now})`.execute(database);
  await sql`insert into documents (
    id, profile_id, kind, format, content_sha256, parsed_content_sha256,
    text, parser_output_json, confidence, created_at, updated_at
  ) values (
    'document-1', 'profile-1', 'resume', 'plaintext', ${'d'.repeat(64)}, ${'e'.repeat(64)},
    'Cobalt resume material', '{}', 1, ${now}, ${now}
  )`.execute(database);
}

async function seedCanonicalEvidence(database: StorageDatabase): Promise<void> {
  await sql`insert into career_evidence (
    id, profile_id, category, name, description, source_document_id, source_text,
    confidence, created_at, updated_at
  ) values (
    'evidence-1', 'profile-1', 'skill', 'Original skill', 'Original fictional evidence',
    'document-1', 'Original fictional evidence', 'explicit', ${now}, ${now}
  )`.execute(database);
}

afterEach(async () => {
  await Promise.allSettled(databases.splice(0).map((database) => closeStorage(database)));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('job repository', () => {
  it('validates and atomically round-trips a job and ordered requirements', async () => {
    const { database } = await temporaryStorage();
    const { jobs } = createRoleProofRepositories(database, () => new Date(now));

    const stored = await jobs.save(job('job-1', 'a'), [
      requirement('requirement-z', 'First requirement'),
      requirement('requirement-a', 'Second requirement'),
    ]);

    expect(StoredJobSchema.parse(stored)).toEqual(stored);
    expect(await jobs.get('job-1')).toEqual(stored);
    const requirements = await jobs.getRequirements('job-1');
    expect(requirements.map(({ id }) => id)).toEqual(['requirement-z', 'requirement-a']);
    expect(requirements.every((value) => JobRequirementSchema.safeParse(value).success)).toBe(true);
  });

  it('deduplicates exact content without adding replacement requirements', async () => {
    const { database } = await temporaryStorage();
    const { jobs } = createRoleProofRepositories(database, () => new Date(now));
    const original = await jobs.save(job('job-original', 'a'), [
      requirement('requirement-original'),
    ]);

    const duplicate = await jobs.save(job('job-copy', 'a'), [requirement('requirement-copy')]);

    expect(duplicate).toEqual(original);
    expect(await jobs.get('job-copy')).toBeUndefined();
    expect(await jobs.getRequirements('job-copy')).toEqual([]);
    expect(await jobs.getRequirements('job-original')).toEqual([
      requirement('requirement-original'),
    ]);
  });

  it('deduplicates normalized-equivalent jobs with different source bytes', async () => {
    const { database } = await temporaryStorage();
    const { jobs } = createRoleProofRepositories(database, () => new Date(now));
    const original = await jobs.save(job('job-normalized', 'a'), [requirement('requirement-1')]);

    const duplicate = await jobs.save(
      { ...job('job-normalized', 'b'), parsedContentSha256: 'a'.repeat(64) },
      [requirement('requirement-2')],
    );

    expect(duplicate).toEqual(original);
    expect(await jobs.getRequirements('job-normalized')).toEqual([requirement('requirement-1')]);
  });

  it('rolls back the job and every requirement when a requirement insert fails', async () => {
    const { database } = await temporaryStorage();
    const { jobs } = createRoleProofRepositories(database, () => new Date(now));
    await jobs.save(job('job-existing', 'a'), [requirement('requirement-conflict')]);

    await expect(
      jobs.save(job('job-rollback', 'b'), [
        requirement('requirement-before'),
        requirement('requirement-conflict'),
      ]),
    ).rejects.toBeInstanceOf(StorageError);
    expect(await jobs.get('job-rollback')).toBeUndefined();
    expect(await jobs.getRequirements('job-rollback')).toEqual([]);
  });
});

describe('analysis repository', () => {
  it('rejects evidence references that are not cited by the analysis', async () => {
    const { database } = await temporaryStorage();
    await seedProfileAndDocument(database);
    await seedCanonicalEvidence(database);
    const { analyses } = createRoleProofRepositories(database, () => new Date(now));

    await expect(
      analyses.save(analysis('analysis-extra-reference'), [reference()], '# Report'),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it.each([
    [
      'matchedRequirements',
      {
        requirementId: 'requirement-1',
        evidenceIds: ['missing-evidence'],
        classification: 'direct',
        score: 1,
        explanation: 'Supported by missing evidence.',
      },
    ],
    [
      'unsupportedClaims',
      {
        text: 'Confirm this claim.',
        classification: 'requires-user-confirmation',
        evidenceIds: ['missing-evidence'],
        explanation: 'The cited evidence needs confirmation.',
      },
    ],
    [
      'suggestedEmphasis',
      {
        text: 'Emphasize this evidence.',
        classification: 'direct',
        evidenceIds: ['missing-evidence'],
        explanation: 'The cited evidence is relevant.',
      },
    ],
    [
      'suggestedAdditions',
      {
        text: 'Confirm this addition.',
        classification: 'requires-user-confirmation',
        evidenceIds: ['missing-evidence'],
        explanation: 'The cited evidence needs confirmation.',
      },
    ],
    [
      'scoreContributions',
      {
        requirementId: 'requirement-1',
        scoringCategory: 'required-technical',
        classification: 'direct',
        evidenceIds: ['missing-evidence'],
        appliedWeight: 10,
        pointsAwarded: 10,
        explanation: 'The cited evidence supports points.',
      },
    ],
  ] as const)('rejects an absent evidence reference cited by %s', async (field, citation) => {
    const { database } = await temporaryStorage();
    await seedProfileAndDocument(database);
    const { analyses } = createRoleProofRepositories(database, () => new Date(now));
    const result = AnalysisResultSchema.parse({
      ...analysis(`analysis-missing-${field}`),
      [field]: [citation],
    });

    await expect(analyses.save(result, [], '# Report')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(analyses.get(result.id)).resolves.toBeUndefined();
  });

  it('atomically saves and round-trips canonical result, evidence snapshot, and report', async () => {
    const { database } = await temporaryStorage();
    await seedProfileAndDocument(database);
    await seedCanonicalEvidence(database);
    const { analyses } = createRoleProofRepositories(database, () => new Date(now));
    const result = analysisCitingEvidence('analysis-1');
    const evidence = [reference()];

    const stored = await analyses.save(result, evidence, '# Cobalt report');

    expect(stored).toEqual({ result, evidenceReferences: evidence, report: '# Cobalt report' });
    expect(await analyses.get('analysis-1')).toEqual(stored);
    const rows = await sql<{ result_json: string; evidence_references_json: string }>`
      select result_json, evidence_references_json from analyses where id = 'analysis-1'
    `.execute(database);
    const row = rows.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) throw new Error('Expected stored analysis row');
    expect(row.result_json).toBe(JSON.stringify(result));
    expect(row.evidence_references_json).toBe(JSON.stringify(evidence));
  });

  it('rejects invalid snapshots without a partial analysis and keeps prior records immutable', async () => {
    const { database } = await temporaryStorage();
    await seedProfileAndDocument(database);
    await seedCanonicalEvidence(database);
    const { analyses } = createRoleProofRepositories(database, () => new Date(now));
    const original = await analyses.save(
      analysisCitingEvidence('analysis-1'),
      [reference()],
      '# Original report',
    );

    await sql`update career_evidence set description = 'User-edited evidence',
      source_text = 'User-edited evidence', updated_at = ${now} where id = 'evidence-1'`.execute(
      database,
    );

    await expect(
      analyses.save(
        analysisCitingEvidence('analysis-invalid'),
        [{ ...reference(), sourceText: '' }] as EvidenceReference[],
        '# Private report',
      ),
    ).rejects.toBeInstanceOf(StorageError);
    await expect(
      analyses.save(
        analysisCitingEvidence('analysis-1'),
        [reference('Changed evidence')],
        '# Changed report',
      ),
    ).rejects.toBeInstanceOf(StorageError);

    expect(await analyses.get('analysis-invalid')).toBeUndefined();
    expect(await analyses.get('analysis-1')).toEqual(original);
    expect(await analyses.listHistory()).toEqual([
      AnalysisHistoryItemSchema.parse({
        schemaVersion: '1.0',
        id: 'analysis-1',
        profileId: 'profile-1',
        resumeDocumentId: 'document-1',
        overallScore: 75,
        recommendation: 'stretch',
        confidence: 0.9,
        hasHardBlocker: false,
        generatedAt: now,
      }),
    ]);
  });

  it('returns schema-valid history in deterministic generated-at then id order', async () => {
    const { database } = await temporaryStorage();
    await seedProfileAndDocument(database);
    const { analyses } = createRoleProofRepositories(database, () => new Date(now));
    await analyses.save(analysis('analysis-z'), [], '# Report Z');
    await analyses.save(analysis('analysis-a'), [], '# Report A');

    const history = await analyses.listHistory();

    expect(history.map(({ id }) => id)).toEqual(['analysis-a', 'analysis-z']);
    expect(history.every((item) => AnalysisHistoryItemSchema.safeParse(item).success)).toBe(true);
  });

  it('keeps history identifiers immutable after linked records are deleted', async () => {
    const { database } = await temporaryStorage();
    await seedProfileAndDocument(database);
    const repositories = createRoleProofRepositories(database, () => new Date(now));
    await repositories.jobs.save(job('job-1', 'a'), []);
    await repositories.analyses.save(analysis('analysis-1', 'job-1'), [], '# Report');

    await sql`delete from jobs where id = 'job-1'`.execute(database);

    expect(await repositories.analyses.listHistory()).toMatchObject([
      { id: 'analysis-1', profileId: 'profile-1', resumeDocumentId: 'document-1', jobId: 'job-1' },
    ]);
  });
});

describe('search API', () => {
  it('searches every entity and analysis history through report or linked job text', async () => {
    const { database } = await temporaryStorage();
    await seedProfileAndDocument(database);
    const repositories = createRoleProofRepositories(database, () => new Date(now));
    await repositories.jobs.save(job('job-1', 'a', 'Saffron infrastructure role'), []);
    await sql`insert into career_evidence (
      id, profile_id, category, name, description, source_document_id, source_text,
      confidence, created_at, updated_at
    ) values (
      'evidence-1', 'profile-1', 'skill', 'Cobalt systems', 'Fictional evidence',
      'document-1', 'Cobalt source', 'explicit', ${now}, ${now}
    )`.execute(database);
    await repositories.analyses.save(analysis('analysis-1', 'job-1'), [], '# Cobalt analysis');

    const cobalt = await repositories.search.search('cobalt');
    const saffron = await repositories.search.search('saffron');

    expect(cobalt.map(({ entityType }) => entityType)).toEqual([
      'evidence',
      'analysis',
      'document',
    ]);
    expect(saffron.map(({ entityType }) => entityType)).toEqual(['analysis', 'job']);
    expect(
      [...cobalt, ...saffron].every((item) => SearchResultSchema.safeParse(item).success),
    ).toBe(true);
  });

  it('handles punctuation and malformed FTS syntax safely with content-free errors', async () => {
    const { database } = await temporaryStorage();
    const { search } = createRoleProofRepositories(database, () => new Date(now));
    const privateQuery = `private') OR delete FROM jobs; --`;

    await expect(search.search('C++ (platform): "unterminated')).resolves.toEqual([]);
    const failure = search.search(privateQuery);
    await expect(failure).resolves.toEqual([]);
    await expect(failure).resolves.not.toThrow(privateQuery);
  });

  it('uses stable rank, entity, and id tie ordering and reflects updates, deletes, and rebuilds', async () => {
    const { database } = await temporaryStorage();
    await seedProfileAndDocument(database);
    const repositories = createRoleProofRepositories(database, () => new Date(now));
    await repositories.jobs.save(job('job-z', 'a', 'Azure term'), []);
    await repositories.jobs.save(job('job-a', 'b', 'Azure term'), []);

    expect((await repositories.search.search('azure')).map(({ id }) => id)).toEqual([
      'job-a',
      'job-z',
    ]);
    await sql`update jobs set text = 'Violet term' where id = 'job-z'`.execute(database);
    await sql`delete from jobs where id = 'job-a'`.execute(database);
    expect((await repositories.search.search('azure')).map(({ id }) => id)).toEqual([]);
    expect((await repositories.search.search('violet')).map(({ id }) => id)).toEqual(['job-z']);

    await sql`insert into jobs_fts(jobs_fts) values ('delete-all')`.execute(database);
    expect(await repositories.search.search('violet')).toEqual([]);
    await rebuildSearchIndexes(database);
    expect((await repositories.search.search('violet')).map(({ id }) => id)).toEqual(['job-z']);
  });
});

describe('analysis deletion', () => {
  it('removes an analysis together with its orphaned job and requirements', async () => {
    const { database } = await temporaryStorage();
    await seedProfileAndDocument(database);
    const repositories = createRoleProofRepositories(database, () => new Date(now));
    await repositories.jobs.save(job('job-1', 'a'), [requirement('requirement-1')]);
    await repositories.analyses.save(analysis('analysis-1', 'job-1'), [], '# Cobalt report');

    const removed = await repositories.analyses.remove('analysis-1');

    expect(removed).toBe(true);
    expect(await repositories.analyses.get('analysis-1')).toBeUndefined();
    expect(await repositories.jobs.get('job-1')).toBeUndefined();
    const requirements = await sql<{ id: string }>`
      select id from job_requirements where job_id = 'job-1'
    `.execute(database);
    expect(requirements.rows).toEqual([]);
    expect(await repositories.search.search('platform')).toEqual([]);
  });

  it('keeps a job that is still referenced by another analysis', async () => {
    const { database } = await temporaryStorage();
    await seedProfileAndDocument(database);
    const repositories = createRoleProofRepositories(database, () => new Date(now));
    await repositories.jobs.save(job('job-1', 'a'), []);
    await repositories.analyses.save(analysis('analysis-1', 'job-1'), [], '# Cobalt report 1');
    await repositories.analyses.save(analysis('analysis-2', 'job-1'), [], '# Cobalt report 2');

    await repositories.analyses.remove('analysis-1');

    expect(await repositories.analyses.get('analysis-1')).toBeUndefined();
    expect(await repositories.jobs.get('job-1')).not.toBeUndefined();
    expect((await repositories.analyses.listHistory()).map(({ id }) => id)).toEqual(['analysis-2']);
  });

  it('reports false when the analysis does not exist', async () => {
    const { database } = await temporaryStorage();
    await seedProfileAndDocument(database);
    const { analyses } = createRoleProofRepositories(database, () => new Date(now));

    expect(await analyses.remove('analysis-missing')).toBe(false);
  });
});

describe('purgeStorage', () => {
  it('removes exactly the resolved database and sidecars and is idempotent', async () => {
    const { database, path } = await temporaryStorage();
    const unrelated = join(resolve(path, '..'), 'keep.txt');
    await writeFile(unrelated, 'keep');
    await closeStorage(database);
    databases.splice(databases.indexOf(database), 1);
    await writeFile(`${path}-wal`, 'wal');
    await writeFile(`${path}-shm`, 'shm');

    const first = await purgeStorage(path);
    const second = await purgeStorage(path);

    expect(first).toEqual({ databaseRemoved: true, walRemoved: true, shmRemoved: true });
    expect(second).toEqual({ databaseRemoved: false, walRemoved: false, shmRemoved: false });
    expect(await readFile(unrelated, 'utf8')).toBe('keep');
  });
});

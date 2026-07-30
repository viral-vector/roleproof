import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import {
  AIEnhancementSchema,
  TransmissionManifestSchema,
  type AIEnhancement,
  type ProviderCallFailureInput,
} from '@roleproof/shared';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import { afterEach, describe, expect, it } from 'vitest';

import {
  closeStorage,
  createRoleProofRepositories,
  openStorage,
  runMigrations,
  StorageError,
  type StorageDatabase,
} from '../src/index.js';
import { initialMigration } from '../src/migrations/0001-initial.js';

const now = '2026-07-01T12:00:00.000Z';
const directories: string[] = [];
const databases: StorageDatabase[] = [];

async function pathForDatabase(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'roleproof-phase3-storage-'));
  directories.push(directory);
  return join(directory, 'roleproof.db');
}

async function database(): Promise<StorageDatabase> {
  const value = await openStorage({ path: ':memory:' });
  databases.push(value);
  return value;
}

async function seedBaseline(db: StorageDatabase, id = 'analysis-1'): Promise<void> {
  await sql`insert into analyses (
    id, schema_version, overall_score, recommendation, confidence, has_hard_blocker,
    result_json, evidence_references_json, report_text, generated_at, created_at
  ) values (
    ${id}, '1.0', 75, 'stretch', 0.9, 0, '{}', '[]', '# Baseline', ${now}, ${now}
  )`.execute(db);
}

const manifest = (operation: string) =>
  TransmissionManifestSchema.parse({
    provider: 'openai',
    model: 'gpt-fictional',
    destination: 'hosted',
    endpointOrigin: 'https://api.openai.com',
    dataCategories: operation === 'map-evidence' ? ['evidence-summary'] : ['job-summary'],
    redactionApplied: true,
    redactionSummary: {
      categories: ['email'],
      replacementCount: 1,
      inputChars: 100,
      outputChars: 90,
    },
  });

function enhancement(baselineAnalysisId = 'analysis-1'): AIEnhancement {
  const operations = [
    'analyze-requirements',
    'map-evidence',
    'suggest-application-changes',
  ] as const;
  return AIEnhancementSchema.parse({
    schemaVersion: '1.0',
    baselineAnalysisId,
    requirementAnalysis: { requirements: [] },
    evidenceMapping: { mappings: [] },
    applicationSuggestions: {
      suggestedEmphasis: [],
      suggestedAdditions: [],
      interviewTopics: [],
      coverLetterAngles: [],
    },
    providerExecutions: operations.map((operation) => ({
      operation,
      provider: 'openai',
      model: 'gpt-fictional',
      destination: 'hosted',
      manifest: manifest(operation),
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costMicroUsd: null },
      requestId: null,
      errorCode: null,
    })),
  });
}

afterEach(async () => {
  await Promise.allSettled(databases.splice(0).map((value) => closeStorage(value)));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('0002 AI persistence migration', () => {
  it('creates the sidecar table and all provider-neutral call columns on a clean database', async () => {
    const db = await database();
    const tables = await sql<{
      name: string;
    }>`select name from sqlite_master where type = 'table'`.execute(db);
    const columns = await sql<{ name: string }>`pragma table_info(provider_calls)`.execute(db);

    expect(tables.rows.map(({ name }) => name)).toContain('ai_enhancements');
    expect(columns.rows.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'baseline_analysis_id',
        'operation',
        'destination',
        'endpoint_origin',
        'error_code',
        'redaction_applied',
        'redaction_categories_json',
        'input_tokens',
        'output_tokens',
        'total_tokens',
        'cost_micro_usd',
        'request_id',
        'started_at',
        'completed_at',
        'duration_ms',
      ]),
    );
  });

  it('migrates the exact released 0001 schema and preserves legacy provider calls', async () => {
    const path = await pathForDatabase();
    const legacy = new Kysely<unknown>({
      dialect: new SqliteDialect({ database: new BetterSqlite3(path) }),
    });
    const migrator = new Migrator({
      db: legacy,
      provider: { getMigrations: () => Promise.resolve({ '0001-initial': initialMigration }) },
    });
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    await sql`insert into analyses (
      id, schema_version, overall_score, recommendation, confidence, has_hard_blocker,
      result_json, evidence_references_json, report_text, generated_at, created_at
    ) values ('analysis-legacy', '1.0', 1, 'skip', 1, 0, '{}', '[]', 'legacy', ${now}, ${now})`.execute(
      legacy,
    );
    await sql`insert into provider_calls (id, analysis_id, provider, model, status, created_at)
      values ('legacy-call', 'analysis-legacy', 'legacy-provider', null, 'failed', ${now})`.execute(
      legacy,
    );
    await legacy.destroy();

    const migrated = await openStorage({ path });
    databases.push(migrated);
    const row = await sql<
      Record<string, unknown>
    >`select * from provider_calls where id = 'legacy-call'`.execute(migrated);
    expect(row.rows[0]).toMatchObject({
      id: 'legacy-call',
      baseline_analysis_id: 'analysis-legacy',
      provider: 'legacy-provider',
      model: null,
      status: 'failed',
      endpoint_origin: null,
      input_tokens: null,
      cost_micro_usd: null,
      redaction_applied: 0,
      redaction_categories_json: '[]',
    });
  });

  it('is idempotent after 0002 is applied', async () => {
    const db = await database();
    await expect(runMigrations(db)).resolves.toBeUndefined();
    await expect(runMigrations(db)).resolves.toBeUndefined();
  });
});

describe('AI enhancement and provider call repositories', () => {
  it('atomically round-trips an immutable sidecar and three stable ordered sanitized calls', async () => {
    const db = await database();
    await seedBaseline(db);
    const repositories = createRoleProofRepositories(db, () => new Date(now));
    const value = enhancement();

    const stored = await repositories.aiEnhancements.save(
      value,
      `provider-config-${'a'.repeat(64)}`,
    );
    expect(await repositories.aiEnhancements.get('analysis-1')).toEqual(stored);
    const calls = await repositories.providerCalls.list('analysis-1');
    expect(calls.map(({ operation }) => operation)).toEqual([
      'analyze-requirements',
      'map-evidence',
      'suggest-application-changes',
    ]);
    expect(calls.every(({ status }) => status === 'succeeded')).toBe(true);
    expect(
      calls.every(({ inputTokens, costMicroUsd }) => inputTokens === 0 && costMicroUsd === null),
    ).toBe(true);
    expect((await repositories.providerCalls.list('analysis-1')).map(({ id }) => id)).toEqual(
      calls.map(({ id }) => id),
    );
    await expect(
      repositories.aiEnhancements.save(value, `provider-config-${'a'.repeat(64)}`),
    ).rejects.toBeInstanceOf(StorageError);
    expect(await repositories.providerCalls.list('analysis-1')).toHaveLength(3);
  });

  it('rejects missing/wrong baselines and incomplete, duplicate, mismatched, or failed operations', async () => {
    const db = await database();
    await seedBaseline(db);
    const repositories = createRoleProofRepositories(db, () => new Date(now));
    await expect(
      repositories.aiEnhancements.save(enhancement('missing'), `provider-config-${'a'.repeat(64)}`),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const valid = enhancement();
    const invalidExecutions = [
      valid.providerExecutions.slice(0, 2),
      [valid.providerExecutions[0]!, valid.providerExecutions[0]!, valid.providerExecutions[2]!],
      valid.providerExecutions.map((call, index) =>
        index === 1 ? { ...call, model: 'wrong' } : call,
      ),
      valid.providerExecutions.map((call, index) =>
        index === 1 ? { ...call, errorCode: 'timeout' as const } : call,
      ),
    ];
    for (const providerExecutions of invalidExecutions) {
      await expect(
        repositories.aiEnhancements.save(
          { ...valid, providerExecutions } as AIEnhancement,
          `provider-config-${'a'.repeat(64)}`,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(await repositories.aiEnhancements.get('analysis-1')).toBeUndefined();
  });

  it('rejects malformed/private failure fields and records only sanitized failure metadata', async () => {
    const db = await database();
    await seedBaseline(db);
    const repositories = createRoleProofRepositories(db, () => new Date(now));
    const failure: ProviderCallFailureInput = {
      baselineAnalysisId: 'analysis-1',
      provider: 'openai',
      model: 'gpt-fictional',
      operation: 'map-evidence',
      destination: 'hosted',
      endpointOrigin: 'https://api.openai.com',
      errorCode: 'timeout',
      manifest: manifest('map-evidence'),
      requestId: null,
      startedAt: now,
      completedAt: now,
      durationMs: 0,
    };

    await expect(
      repositories.providerCalls.recordFailure({ ...failure, prompt: 'PRIVATE-FRAGMENT' } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      repositories.providerCalls.recordFailure({ ...failure, baselineAnalysisId: 'missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const stored = await repositories.providerCalls.recordFailure(failure);
    expect(stored).toMatchObject({
      status: 'failed',
      errorCode: 'timeout',
      inputTokens: null,
      costMicroUsd: null,
    });
    const rows = await sql<{ all_text: string }>`select group_concat(
      coalesce(id, '') || coalesce(provider, '') || coalesce(model, '') ||
      coalesce(redaction_categories_json, '') || coalesce(request_id, ''), '') as all_text
      from provider_calls`.execute(db);
    expect(rows.rows[0]?.all_text).not.toContain('PRIVATE-FRAGMENT');
  });

  it('rolls back the sidecar when a derived call insert fails', async () => {
    const db = await database();
    await seedBaseline(db);
    await sql`create trigger reject_provider_call before insert on provider_calls begin select raise(abort, 'forced'); end`.execute(
      db,
    );
    const repositories = createRoleProofRepositories(db, () => new Date(now));

    await expect(
      repositories.aiEnhancements.save(enhancement(), `provider-config-${'a'.repeat(64)}`),
    ).rejects.toBeInstanceOf(StorageError);
    expect((await sql`select * from ai_enhancements`.execute(db)).rows).toHaveLength(0);
    expect((await sql`select * from provider_calls`.execute(db)).rows).toHaveLength(0);
  });

  it('cascades sidecars and calls when the deterministic baseline is purged', async () => {
    const db = await database();
    await seedBaseline(db);
    const repositories = createRoleProofRepositories(db, () => new Date(now));
    await repositories.aiEnhancements.save(enhancement(), `provider-config-${'a'.repeat(64)}`);
    await sql`delete from analyses where id = 'analysis-1'`.execute(db);

    expect(await repositories.aiEnhancements.get('analysis-1')).toBeUndefined();
    expect(await repositories.providerCalls.list('analysis-1')).toEqual([]);
  });

  it('does not leave rejected raw fragments in database rows or file bytes', async () => {
    const path = await pathForDatabase();
    const db = await openStorage({ path });
    await seedBaseline(db);
    const repositories = createRoleProofRepositories(db, () => new Date(now));
    await expect(
      repositories.providerCalls.recordFailure({
        baselineAnalysisId: 'analysis-1',
        provider: 'openai',
        model: 'gpt-fictional',
        operation: 'map-evidence',
        destination: 'hosted',
        endpointOrigin: 'https://api.openai.com',
        errorCode: 'timeout',
        requestId: null,
        startedAt: now,
        completedAt: now,
        durationMs: 0,
        rawResponse: 'RAW-PRIVATE-FRAGMENT',
      } as never),
    ).rejects.toBeInstanceOf(StorageError);
    await sql`pragma wal_checkpoint(truncate)`.execute(db);
    await closeStorage(db);

    expect((await readFile(path)).includes(Buffer.from('RAW-PRIVATE-FRAGMENT'))).toBe(false);
  });
});

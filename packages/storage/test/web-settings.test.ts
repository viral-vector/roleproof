import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalSettingsSchema, type LocalSettings } from '@roleproof/shared';
import BetterSqlite3 from 'better-sqlite3';
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
import { aiPersistenceMigration } from '../src/migrations/0002-ai-persistence.js';
import { docxFormatMigration } from '../src/migrations/0003-docx-format.js';

const now = '2026-07-01T12:00:00.000Z';
const directories: string[] = [];
const databases: StorageDatabase[] = [];

const releasedMigrations = {
  '0001-initial': initialMigration,
  '0002-ai-persistence': aiPersistenceMigration,
  '0003-docx-format': docxFormatMigration,
};

afterEach(async () => {
  await Promise.allSettled(databases.splice(0).map((value) => closeStorage(value)));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function pathForDatabase(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `roleproof-${prefix}-`));
  directories.push(directory);
  return join(directory, 'roleproof.db');
}

async function temporaryStorage() {
  const path = await pathForDatabase('web-settings');
  const database = await openStorage({ path });
  databases.push(database);
  return { database, path };
}

describe('web settings repository', () => {
  it('returns empty settings before any update', async () => {
    const { database } = await temporaryStorage();
    const { settings } = createRoleProofRepositories(database, () => new Date(now));

    expect(await settings.get()).toEqual({});
    expect(LocalSettingsSchema.safeParse(await settings.get()).success).toBe(true);
  });

  it('persists settings updates and reflects them on a fresh repository instance', async () => {
    const { database } = await temporaryStorage();
    const input: LocalSettings = {
      provider: 'openai-compatible',
      model: 'fictional-model',
      destination: 'local',
      baseUrl: 'http://localhost:11434/v1',
      redactEmployer: true,
      redactClearance: false,
      redactionTerms: ['fictional-client'],
      defaultExportFormat: 'markdown',
      maxTotalTokens: 4096,
      maxCostUsd: 0.5,
      providerTimeoutMs: 60_000,
    };
    const first = createRoleProofRepositories(database, () => new Date(now));

    const saved = await first.settings.update(input);
    const reloaded = await createRoleProofRepositories(
      database,
      () => new Date(now),
    ).settings.get();

    expect(LocalSettingsSchema.parse(saved)).toEqual(input);
    expect(reloaded).toEqual(input);
    const rows = await sql<{ id: number }>`select id from settings where id = 1`.execute(database);
    expect(rows.rows).toHaveLength(1);
  });

  it('merges partial updates instead of clearing stored fields', async () => {
    const { database } = await temporaryStorage();
    const { settings } = createRoleProofRepositories(database, () => new Date(now));
    await settings.update({ provider: 'openai', model: 'fictional-model' });

    const merged = await settings.update({ defaultExportFormat: 'json' });

    expect(merged).toEqual({
      provider: 'openai',
      model: 'fictional-model',
      defaultExportFormat: 'json',
    });
  });

  it('validates provider consistency after merging partial updates', async () => {
    const { database } = await temporaryStorage();
    const { settings } = createRoleProofRepositories(database, () => new Date(now));
    await settings.update({
      provider: 'openai',
      model: 'fictional-model',
      baseUrl: 'http://localhost:11434/v1',
    });

    const merged = await settings.update({ provider: 'openai-compatible' });

    expect(merged).toEqual({
      provider: 'openai-compatible',
      model: 'fictional-model',
      baseUrl: 'http://localhost:11434/v1',
    });
  });

  it('clears stored fields when an update sends explicit null values', async () => {
    const { database } = await temporaryStorage();
    const { settings } = createRoleProofRepositories(database, () => new Date(now));
    await settings.update({
      provider: 'openai-compatible',
      model: 'fictional-model',
      baseUrl: 'http://localhost:11434/v1',
      destination: 'local',
      defaultExportFormat: 'markdown',
      maxTotalTokens: 4096,
      maxCostUsd: 0.5,
      providerTimeoutMs: 60_000,
    });

    const cleared = await settings.update({
      provider: null,
      model: null,
      baseUrl: null,
      defaultExportFormat: null,
      maxTotalTokens: null,
      maxCostUsd: null,
      providerTimeoutMs: null,
    });

    expect(cleared).toEqual({ destination: 'local' });
    expect(await settings.get()).toEqual({ destination: 'local' });
  });

  it('rejects settings that violate the canonical schema without persisting them', async () => {
    const { database } = await temporaryStorage();
    const { settings } = createRoleProofRepositories(database, () => new Date(now));
    await settings.update({ defaultExportFormat: 'markdown' });

    await expect(
      settings.update({ provider: 'openai-compatible', model: 'fictional-model' }),
    ).rejects.toBeInstanceOf(StorageError);

    expect(await settings.get()).toEqual({ defaultExportFormat: 'markdown' });
  });
});

describe('0004 web settings migration', () => {
  it('adds settings columns while preserving released rows', async () => {
    const path = await pathForDatabase('web-settings-migration');
    const legacy = new Kysely<unknown>({
      dialect: new SqliteDialect({ database: new BetterSqlite3(path) }),
    });
    const migrator = new Migrator({
      db: legacy,
      provider: { getMigrations: () => Promise.resolve(releasedMigrations) },
    });
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    await sql`insert into settings (id, created_at, updated_at)
      values (1, ${now}, ${now})`.execute(legacy);
    await legacy.destroy();

    const migrated = await openStorage({ path });
    databases.push(migrated);
    const { settings } = createRoleProofRepositories(migrated, () => new Date(now));
    expect(await settings.get()).toEqual({});

    await settings.update({ provider: 'openai', model: 'fictional-model', maxTotalTokens: 2048 });
    const rows = await sql<{ provider: string | null; model: string | null }>`
      select provider, model, max_total_tokens from settings where id = 1
    `.execute(migrated);
    expect(rows.rows[0]).toEqual({
      provider: 'openai',
      model: 'fictional-model',
      max_total_tokens: 2048,
    });
  });

  it('is idempotent after 0004 is applied', async () => {
    const db = await openStorage({ path: ':memory:' });
    databases.push(db);
    await expect(runMigrations(db)).resolves.toBeUndefined();
    await expect(runMigrations(db)).resolves.toBeUndefined();
  });
});

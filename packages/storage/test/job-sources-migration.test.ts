import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoleProofRepositories, closeStorage, openStorage } from '../src/index.js';
import { initialMigration } from '../src/migrations/0001-initial.js';
import { aiPersistenceMigration } from '../src/migrations/0002-ai-persistence.js';
import { docxFormatMigration } from '../src/migrations/0003-docx-format.js';
import { webSettingsMigration } from '../src/migrations/0004-web-settings.js';
import { providerSettingsAlignmentMigration } from '../src/migrations/0005-provider-settings-alignment.js';
import { settingsCostRateRepairMigration } from '../src/migrations/0006-settings-cost-rate-repair.js';
import { jobSourcesMigration } from '../src/migrations/0007-job-sources.js';
import type { StorageDatabase } from '../src/index.js';

const releasedMigrations = {
  '0001-initial': initialMigration,
  '0002-ai-persistence': aiPersistenceMigration,
  '0003-docx-format': docxFormatMigration,
  '0004-web-settings': webSettingsMigration,
  '0005-provider-settings-alignment': providerSettingsAlignmentMigration,
  '0006-settings-cost-rate-repair': settingsCostRateRepairMigration,
};

const releasedWithJobSources = {
  ...releasedMigrations,
  '0007-job-sources': jobSourcesMigration,
};

const databases: StorageDatabase[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.allSettled(databases.splice(0).map((database) => closeStorage(database)));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'roleproof-job-source-'));
  directories.push(directory);
  return join(directory, 'roleproof.db');
}

async function createLegacyDatabase(path: string): Promise<void> {
  const legacy = new Kysely<unknown>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(path) }),
  });
  try {
    const migrator = new Migrator({
      db: legacy,
      provider: { getMigrations: () => Promise.resolve(releasedMigrations) },
    });
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    await sql`
      insert into profiles (
        id, name, target_titles_json, preferred_locations_json, remote_preference,
        target_salary_min, target_salary_max, work_authorization, created_at, updated_at
      ) values (
        'profile-local', null, '[]', '[]', null, null, null, null,
        '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z'
      )
    `.execute(legacy);
    await sql`
      insert into jobs (
        id, title, company, format, content_sha256, parsed_content_sha256, text, parser_output_json,
        confidence, created_at, updated_at
      ) values (
        'job-legacy', null, null, 'plaintext', ${'a'.repeat(64)}, ${'b'.repeat(64)}, 'Fictional job text', '{"warnings":[]}',
        1, '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z'
      )
    `.execute(legacy);
  } finally {
    await legacy.destroy();
  }
}

describe('job source storage migration', () => {
  it('adds the job_sources table and preserves previous data', async () => {
    const path = await temporaryDatabasePath();
    await createLegacyDatabase(path);

    const database = await openStorage({ path });
    databases.push(database);
    const repositories = createRoleProofRepositories(database);

    const source = await repositories.jobs.saveSource({
      schemaVersion: '1.0',
      jobId: 'job-legacy',
      url: 'https://boards.greenhouse.io/fictionalco/jobs/123',
      finalUrl: 'https://boards.greenhouse.io/fictionalco/jobs/123',
      retrievedAt: '2026-08-02T10:00:00.000Z',
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
      sourceClassification: 'official-ats',
      atsProvider: 'greenhouse',
      removedOrUnavailable: false,
      confidence: 0.95,
      warnings: [],
    });

    expect(source.jobId).toBe('job-legacy');
    expect((await repositories.jobs.getSource('job-legacy'))?.sourceClassification).toBe(
      'official-ats',
    );

    const rows = await sql<{ name: string }>`
      select name from sqlite_master where type = 'table' and name = 'job_sources'
    `.execute(database);
    expect(rows.rows).toHaveLength(1);
  });

  it('widens the ats_provider constraint and preserves job_sources rows across 0008', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'roleproof-icims-'));
    directories.push(directory);
    const path = join(directory, 'roleproof.db');

    const legacy = new Kysely<unknown>({
      dialect: new SqliteDialect({ database: new BetterSqlite3(path) }),
    });
    try {
      const migrator = new Migrator({
        db: legacy,
        provider: { getMigrations: () => Promise.resolve(releasedWithJobSources) },
      });
      expect((await migrator.migrateToLatest()).error).toBeUndefined();
      await sql`
        insert into jobs (
          id, title, company, format, content_sha256, parsed_content_sha256, text, parser_output_json,
          confidence, created_at, updated_at
        ) values (
          'job-icims-legacy', null, null, 'plaintext', ${'c'.repeat(64)}, ${'d'.repeat(64)}, 'Fictional job text', '{"warnings":[]}',
          1, '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z'
        )
      `.execute(legacy);
      await sql`
        insert into job_sources (
          job_id, url, retrieved_at, source_classification, ats_provider,
          removed_or_unavailable, confidence, warnings_json, created_at, updated_at
        ) values (
          'job-icims-legacy', 'https://careers-fictionalco.icims.com/jobs/123',
          '2026-08-02T10:00:00.000Z', 'unknown', 'unknown',
          0, 0.95, '[]', '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z'
        )
      `.execute(legacy);
    } finally {
      await legacy.destroy();
    }

    const database = await openStorage({ path });
    databases.push(database);
    const repositories = createRoleProofRepositories(database);

    const preserved = await repositories.jobs.getSource('job-icims-legacy');
    expect(preserved?.url).toBe('https://careers-fictionalco.icims.com/jobs/123');
    expect(preserved?.atsProvider).toBe('unknown');

    const saved = await repositories.jobs.saveSource({
      schemaVersion: '1.0',
      jobId: 'job-icims-legacy',
      url: 'https://careers-fictionalco.icims.com/jobs/123',
      finalUrl: 'https://careers-fictionalco.icims.com/jobs/123',
      retrievedAt: '2026-08-02T10:00:00.000Z',
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
      sourceClassification: 'official-ats',
      atsProvider: 'icims',
      removedOrUnavailable: false,
      confidence: 0.95,
      warnings: [],
    });
    expect(saved.atsProvider).toBe('icims');
    expect((await repositories.jobs.getSource('job-icims-legacy'))?.atsProvider).toBe('icims');
  });
});

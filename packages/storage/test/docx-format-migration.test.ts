import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import { afterEach, describe, expect, it } from 'vitest';

import { closeStorage, openStorage, runMigrations, type StorageDatabase } from '../src/index.js';
import { aiPersistenceMigration } from '../src/migrations/0002-ai-persistence.js';
import { initialMigration } from '../src/migrations/0001-initial.js';

const now = '2026-07-01T12:00:00.000Z';
const directories: string[] = [];
const databases: StorageDatabase[] = [];

const releasedMigrations = {
  '0001-initial': initialMigration,
  '0002-ai-persistence': aiPersistenceMigration,
};

afterEach(async () => {
  await Promise.allSettled(databases.splice(0).map((value) => closeStorage(value)));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function pathForDatabase(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'roleproof-docx-migration-'));
  directories.push(directory);
  return join(directory, 'roleproof.db');
}

async function insertDocument(
  db: StorageDatabase | Kysely<unknown>,
  id: string,
  format: 'plaintext' | 'pdf' | 'docx',
): Promise<void> {
  const contentSha256 = `${id}${'a'.repeat(64 - id.length)}`;
  const parsedSha256 = `${id}${'b'.repeat(64 - id.length)}`;
  await sql`insert into documents (
    id, profile_id, kind, format, content_sha256, parsed_content_sha256,
    text, parser_output_json, confidence, created_at, updated_at
  ) values (
    ${id}, 'profile-legacy', 'resume', ${format}, ${contentSha256}, ${parsedSha256},
    ${id === 'document-legacy' ? 'legacy resume text' : `${id} docx text`}, '{}', 1, ${now}, ${now}
  )`.execute(db);
}

describe('0003 DOCX format migration', () => {
  it('widens the documents format constraint and preserves released rows and FTS content', async () => {
    const path = await pathForDatabase();
    const legacy = new Kysely<unknown>({
      dialect: new SqliteDialect({ database: new BetterSqlite3(path) }),
    });
    const migrator = new Migrator({
      db: legacy,
      provider: { getMigrations: () => Promise.resolve(releasedMigrations) },
    });
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    await sql`insert into profiles (id, created_at, updated_at)
      values ('profile-legacy', ${now}, ${now})`.execute(legacy);
    await insertDocument(legacy, 'document-legacy', 'pdf');
    await sql`insert into career_evidence (
      id, profile_id, category, name, description, source_document_id, confidence,
      created_at, updated_at
    ) values (
      'evidence-legacy', 'profile-legacy', 'skill', 'TypeScript', 'Built fictional services.',
      'document-legacy', 'explicit', ${now}, ${now}
    )`.execute(legacy);
    await legacy.destroy();

    const migrated = await openStorage({ path });
    databases.push(migrated);
    const preserved = await sql<
      Record<string, unknown>
    >`select * from documents where id = 'document-legacy'`.execute(migrated);
    expect(preserved.rows[0]).toMatchObject({
      id: 'document-legacy',
      format: 'pdf',
      text: 'legacy resume text',
    });
    const evidence = await sql<
      Record<string, unknown>
    >`select * from career_evidence where id = 'evidence-legacy'`.execute(migrated);
    expect(evidence.rows[0]).toMatchObject({
      id: 'evidence-legacy',
      source_document_id: 'document-legacy',
    });

    await insertDocument(migrated, 'document-docx', 'docx');
    const fts = await sql<{ id: string }>`select id from documents_fts
      where documents_fts match 'docx text'`.execute(migrated);
    expect(fts.rows.map(({ id }) => id)).toContain('document-docx');
    const legacyFts = await sql<{ id: string }>`select id from documents_fts
      where documents_fts match 'legacy resume'`.execute(migrated);
    expect(legacyFts.rows.map(({ id }) => id)).toContain('document-legacy');
  });

  it('is idempotent after 0003 is applied', async () => {
    const db = await openStorage({ path: ':memory:' });
    databases.push(db);
    await expect(runMigrations(db)).resolves.toBeUndefined();
    await expect(runMigrations(db)).resolves.toBeUndefined();
  });
});

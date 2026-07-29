import { access, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import {
  closeStorage,
  openStorage,
  resolveDatabasePath,
  runMigrations,
  StorageError,
  type StorageDatabase,
} from '../src/index.js';

const temporaryDirectories: string[] = [];
const databases: StorageDatabase[] = [];

async function temporaryDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'roleproof-storage-'));
  temporaryDirectories.push(directory);
  return join(directory, 'nested', 'roleproof.db');
}

async function openTemporaryStorage(): Promise<StorageDatabase> {
  const database = await openStorage({ path: await temporaryDatabasePath() });
  databases.push(database);
  return database;
}

async function objectNames(
  database: StorageDatabase,
  type: 'table' | 'trigger',
): Promise<string[]> {
  const result = await sql<{ name: string }>`
    select name from sqlite_master where type = ${type} order by name
  `.execute(database);
  return result.rows.map(({ name }) => name);
}

afterEach(async () => {
  await Promise.allSettled(databases.splice(0).map((database) => closeStorage(database)));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('database path resolution', () => {
  it('uses the user home directory by default', () => {
    expect(resolveDatabasePath()).toBe(join(homedir(), '.roleproof', 'roleproof.db'));
  });

  it('preserves an explicit absolute path and rejects cwd-relative paths', () => {
    const explicitPath = join(tmpdir(), 'roleproof-explicit.db');
    expect(isAbsolute(explicitPath)).toBe(true);
    expect(resolveDatabasePath(explicitPath)).toBe(explicitPath);
    expect(() => resolveDatabasePath('relative.db')).toThrowError(StorageError);
  });
});

describe('SQLite foundation', () => {
  it('creates all canonical tables and external-content FTS tables', async () => {
    const database = await openTemporaryStorage();
    const names = await objectNames(database, 'table');

    expect(names).toEqual(
      expect.arrayContaining([
        'profiles',
        'documents',
        'career_evidence',
        'jobs',
        'job_requirements',
        'analyses',
        'provider_calls',
        'settings',
        'documents_fts',
        'jobs_fts',
        'career_evidence_fts',
        'analyses_fts',
      ]),
    );

    const ftsSql = await sql<{ name: string; sql: string }>`
      select name, sql from sqlite_master
      where type = 'table' and name in ('documents_fts', 'jobs_fts', 'career_evidence_fts', 'analyses_fts')
    `.execute(database);
    expect(ftsSql.rows).toHaveLength(4);
    expect(ftsSql.rows.every(({ sql: statement }) => statement.includes("content='"))).toBe(true);
  });

  it('enables required safety and concurrency pragmas for a writable file database', async () => {
    const database = await openTemporaryStorage();
    const foreignKeys = await sql<{ foreign_keys: number }>`pragma foreign_keys`.execute(database);
    const journalMode = await sql<{ journal_mode: string }>`pragma journal_mode`.execute(database);
    const busyTimeout = await sql<{ timeout: number }>`pragma busy_timeout`.execute(database);
    const secureDelete = await sql<{ secure_delete: number }>`pragma secure_delete`.execute(
      database,
    );

    expect(foreignKeys.rows[0]?.foreign_keys).toBe(1);
    expect(journalMode.rows[0]?.journal_mode).toBe('wal');
    expect(busyTimeout.rows[0]?.timeout).toBeGreaterThan(0);
    expect(secureDelete.rows[0]?.secure_delete).toBe(1);
  });

  it('enforces foreign keys', async () => {
    const database = await openTemporaryStorage();
    await expect(
      sql`
      insert into documents (
        id, profile_id, kind, format, content_sha256, parsed_content_sha256,
        text, parser_output_json, confidence, created_at, updated_at
      ) values (
        'document-1', 'missing-profile', 'resume', 'plaintext', ${'a'.repeat(64)},
        ${'b'.repeat(64)}, 'text', '{}', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      )
    `.execute(database),
    ).rejects.toThrow(/foreign key/iu);
  });

  it('stores the canonical profile, career evidence, and requirement fields', async () => {
    const database = await openTemporaryStorage();
    await sql`insert into profiles (
      id, target_titles_json, preferred_locations_json, created_at, updated_at
    ) values (
      'profile-1', '["Backend Engineer"]', '["Remote"]',
      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    )`.execute(database);
    await sql`insert into documents (
      id, profile_id, kind, format, content_sha256, parsed_content_sha256,
      text, parser_output_json, confidence, created_at, updated_at
    ) values (
      'document-1', 'profile-1', 'resume', 'plaintext', ${'a'.repeat(64)}, ${'b'.repeat(64)},
      'Skills: TypeScript', '{}', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    )`.execute(database);
    await sql`insert into career_evidence (
      id, profile_id, category, name, normalized_name, description, source_document_id,
      source_text, confidence, created_at, updated_at
    ) values (
      'evidence-1', 'profile-1', 'skill', 'TypeScript', 'typescript',
      'Built fictional services.', 'document-1', 'Skills: TypeScript', 'explicit',
      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    )`.execute(database);
    await sql`insert into jobs (
      id, format, content_sha256, parsed_content_sha256, text, parser_output_json,
      confidence, created_at, updated_at
    ) values (
      'job-1', 'plaintext', ${'c'.repeat(64)}, ${'d'.repeat(64)}, 'TypeScript preferred',
      '{}', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    )`.execute(database);
    await sql`insert into job_requirements (
      id, job_id, category, text, normalized_name, importance, years_requested, position, created_at
    ) values (
      'requirement-1', 'job-1', 'language', 'TypeScript preferred', 'typescript',
      'contextual', 2, 0, '2026-01-01T00:00:00Z'
    )`.execute(database);

    const evidence = await sql<{ category: string; confidence: string; name: string }>`
      select category, confidence, name from career_evidence where id = 'evidence-1'
    `.execute(database);
    const requirement = await sql<{ category: string; importance: string }>`
      select category, importance from job_requirements where id = 'requirement-1'
    `.execute(database);
    expect(evidence.rows).toEqual([
      { category: 'skill', confidence: 'explicit', name: 'TypeScript' },
    ]);
    expect(requirement.rows).toEqual([{ category: 'language', importance: 'contextual' }]);
  });

  it('stores schema-versioned analyses with immutable evidence-reference snapshots', async () => {
    const database = await openTemporaryStorage();
    await sql`insert into analyses (
      id, schema_version, overall_score, recommendation, confidence, has_hard_blocker,
      result_json, evidence_references_json, report_text, generated_at, created_at
    ) values (
      'analysis-1', '1.0', 75, 'stretch', 0.9, 0, '{}',
      '[{"evidenceId":"evidence-1"}]', '# Report',
      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    )`.execute(database);

    const result = await sql<{ evidence_references_json: string; schema_version: string }>`
      select schema_version, evidence_references_json from analyses where id = 'analysis-1'
    `.execute(database);
    expect(result.rows).toEqual([
      { schema_version: '1.0', evidence_references_json: '[{"evidenceId":"evidence-1"}]' },
    ]);
  });

  it('reruns the immutable migration idempotently', async () => {
    const database = await openTemporaryStorage();
    const before = await objectNames(database, 'table');
    await expect(runMigrations(database)).resolves.toBeUndefined();
    expect(await objectNames(database, 'table')).toEqual(before);
  });

  it('synchronizes FTS rows on insert, update, and delete and supports rebuild', async () => {
    const database = await openTemporaryStorage();
    await sql`insert into profiles (id, name, created_at, updated_at)
      values ('profile-1', 'Fictional Candidate', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`.execute(
      database,
    );
    await sql`insert into documents (
      id, profile_id, kind, format, content_sha256, parsed_content_sha256,
      text, parser_output_json, confidence, created_at, updated_at
    ) values (
      'document-1', 'profile-1', 'resume', 'plaintext', ${'a'.repeat(64)}, ${'b'.repeat(64)},
      'cobalt systems', '{}', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    )`.execute(database);

    const inserted = await sql<{ id: string }>`
      select id from documents_fts where documents_fts match 'cobalt'
    `.execute(database);
    expect(inserted.rows).toEqual([{ id: 'document-1' }]);

    await sql`update documents set text = 'amber systems' where id = 'document-1'`.execute(
      database,
    );
    const oldTerm =
      await sql`select id from documents_fts where documents_fts match 'cobalt'`.execute(database);
    const updated = await sql<{
      id: string;
    }>`select id from documents_fts where documents_fts match 'amber'`.execute(database);
    expect(oldTerm.rows).toHaveLength(0);
    expect(updated.rows).toEqual([{ id: 'document-1' }]);

    await sql`insert into documents_fts(documents_fts) values ('delete-all')`.execute(database);
    await sql`insert into documents_fts(documents_fts) values ('rebuild')`.execute(database);
    const rebuilt = await sql<{
      id: string;
    }>`select id from documents_fts where documents_fts match 'amber'`.execute(database);
    expect(rebuilt.rows).toEqual([{ id: 'document-1' }]);

    await sql`delete from documents where id = 'document-1'`.execute(database);
    const deleted =
      await sql`select id from documents_fts where documents_fts match 'amber'`.execute(database);
    expect(deleted.rows).toHaveLength(0);
  });

  it('closes the Kysely connection', async () => {
    const database = await openTemporaryStorage();
    await closeStorage(database);
    databases.splice(databases.indexOf(database), 1);
    await expect(sql`select 1`.execute(database)).rejects.toThrow();
  });

  it('opens existing storage read-only without creating or migrating files', async () => {
    const path = await temporaryDatabasePath();
    const writable = await openStorage({ path });
    await closeStorage(writable);

    const readOnly = await openStorage({ path, readOnly: true });
    databases.push(readOnly);
    await expect(sql`select id from profiles`.execute(readOnly)).resolves.toBeDefined();
    await expect(
      sql`insert into profiles (id, created_at, updated_at)
        values ('forbidden', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`.execute(readOnly),
    ).rejects.toThrow();

    const missing = join(temporaryDirectories[0] ?? '', 'missing', 'roleproof.db');
    await expect(openStorage({ path: missing, readOnly: true })).rejects.toBeInstanceOf(
      StorageError,
    );
    await expect(access(missing)).rejects.toThrow();
  });

  it('reads a consistent SQLite snapshot while uncheckpointed WAL content exists', async () => {
    const path = await temporaryDatabasePath();
    const writable = await openStorage({ path });
    databases.push(writable);
    await sql`insert into profiles (id, created_at, updated_at)
      values ('profile-live', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`.execute(writable);

    const readOnly = await openStorage({ path, readOnly: true });
    databases.push(readOnly);
    const rows = await sql<{
      id: string;
    }>`select id from profiles where id = 'profile-live'`.execute(readOnly);
    expect(rows.rows).toEqual([{ id: 'profile-live' }]);
  });
});

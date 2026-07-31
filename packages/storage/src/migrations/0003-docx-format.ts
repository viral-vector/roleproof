import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

const upStatements = [
  'pragma foreign_keys = off',
  'drop index documents_profile_id_idx',
  'drop index documents_parsed_hash_idx',
  `create table documents_0003 (
    id text primary key,
    profile_id text not null references profiles(id) on delete cascade,
    kind text not null check (kind in ('resume', 'evidence-note')),
    format text not null check (format in ('plaintext', 'pdf', 'docx')),
    original_name text,
    content_sha256 text not null check (length(content_sha256) = 64),
    parsed_content_sha256 text not null check (length(parsed_content_sha256) = 64),
    text text not null check (length(trim(text)) > 0),
    parser_output_json text not null check (json_valid(parser_output_json)),
    confidence real not null check (confidence >= 0 and confidence <= 1),
    created_at text not null,
    updated_at text not null,
    check (kind != 'evidence-note' or format = 'plaintext'),
    unique (profile_id, content_sha256)
  ) strict`,
  `insert into documents_0003 (
    id, profile_id, kind, format, original_name, content_sha256, parsed_content_sha256,
    text, parser_output_json, confidence, created_at, updated_at
  ) select
    id, profile_id, kind, format, original_name, content_sha256, parsed_content_sha256,
    text, parser_output_json, confidence, created_at, updated_at
  from documents`,
  'drop table documents',
  'alter table documents_0003 rename to documents',
  'create index documents_profile_id_idx on documents(profile_id)',
  'create index documents_parsed_hash_idx on documents(parsed_content_sha256)',
  `insert into documents_fts(documents_fts) values ('rebuild')`,
  `create trigger documents_fts_ai after insert on documents begin
    insert into documents_fts(rowid, id, text) values (new.rowid, new.id, new.text);
  end`,
  `create trigger documents_fts_ad after delete on documents begin
    insert into documents_fts(documents_fts, rowid, id, text)
      values ('delete', old.rowid, old.id, old.text);
  end`,
  `create trigger documents_fts_au after update on documents begin
    insert into documents_fts(documents_fts, rowid, id, text)
      values ('delete', old.rowid, old.id, old.text);
    insert into documents_fts(rowid, id, text) values (new.rowid, new.id, new.text);
  end`,
  'pragma foreign_keys = on',
] as const;

export const docxFormatMigration: Migration = Object.freeze({
  async up(database: Kysely<unknown>): Promise<void> {
    for (const statement of upStatements) await sql.raw(statement).execute(database);
  },
  down(): Promise<void> {
    return Promise.reject(new Error('Migration 0003 does not support rollback'));
  },
});

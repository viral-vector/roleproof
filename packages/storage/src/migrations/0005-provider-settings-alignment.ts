import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

const upStatements = [
  `alter table settings add column structured_output_mode text
    check (structured_output_mode in ('json-schema', 'json-object'))`,
  `alter table settings add column input_micro_usd_per_million_tokens integer
    check (input_micro_usd_per_million_tokens is null or input_micro_usd_per_million_tokens >= 0)`,
  `alter table settings add column output_micro_usd_per_million_tokens integer
    check (output_micro_usd_per_million_tokens is null or output_micro_usd_per_million_tokens >= 0)`,
] as const;

export const providerSettingsAlignmentMigration: Migration = Object.freeze({
  async up(database: Kysely<unknown>): Promise<void> {
    for (const statement of upStatements) await sql.raw(statement).execute(database);
  },
  down(): Promise<void> {
    return Promise.reject(new Error('Migration 0005 does not support rollback'));
  },
});

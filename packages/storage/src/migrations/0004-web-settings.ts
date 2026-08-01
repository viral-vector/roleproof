import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

const upStatements = [
  `alter table settings add column provider text
    check (provider in ('openai', 'openai-compatible'))`,
  `alter table settings add column model text
    check (model is null or length(trim(model)) > 0)`,
  `alter table settings add column destination text
    check (destination in ('hosted', 'local', 'custom'))`,
  `alter table settings add column base_url text
    check (base_url is null or length(trim(base_url)) > 0)`,
  `alter table settings add column default_export_format text
    check (default_export_format in ('json', 'markdown'))`,
  `alter table settings add column redact_employer integer
    check (redact_employer in (0, 1))`,
  `alter table settings add column redact_clearance integer
    check (redact_clearance in (0, 1))`,
  `alter table settings add column redaction_terms_json text
    check (redaction_terms_json is null or json_valid(redaction_terms_json))`,
  `alter table settings add column max_total_tokens integer
    check (max_total_tokens is null or max_total_tokens >= 1)`,
  `alter table settings add column max_cost_usd real
    check (max_cost_usd is null or max_cost_usd >= 0)`,
  `alter table settings add column provider_timeout_ms integer
    check (provider_timeout_ms is null or provider_timeout_ms >= 1000)`,
] as const;

export const webSettingsMigration: Migration = Object.freeze({
  async up(database: Kysely<unknown>): Promise<void> {
    for (const statement of upStatements) await sql.raw(statement).execute(database);
  },
  down(): Promise<void> {
    return Promise.reject(new Error('Migration 0004 does not support rollback'));
  },
});

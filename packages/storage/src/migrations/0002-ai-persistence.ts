import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

const statements = [
  'alter table provider_calls rename to provider_calls_0001',
  `create table provider_calls (
    id text primary key,
    baseline_analysis_id text references analyses(id) on delete cascade,
    provider text not null check (length(trim(provider)) > 0),
    model text check (model is null or length(trim(model)) > 0),
    operation text not null check (operation in (
      'analyze-requirements', 'map-evidence', 'suggest-application-changes', 'health-check'
    )),
    destination text not null check (destination in ('hosted', 'local', 'custom')),
    endpoint_origin text,
    status text not null check (status in ('succeeded', 'failed')),
    error_code text check (error_code is null or error_code in (
      'auth', 'rate-limit', 'timeout', 'unavailable', 'refusal', 'incomplete',
      'invalid-output', 'budget-exceeded', 'configuration'
    )),
    redaction_applied integer not null check (redaction_applied in (0, 1)),
    redaction_categories_json text not null check (json_valid(redaction_categories_json)),
    input_tokens integer check (input_tokens is null or input_tokens >= 0),
    output_tokens integer check (output_tokens is null or output_tokens >= 0),
    total_tokens integer check (total_tokens is null or total_tokens >= 0),
    cost_micro_usd integer check (cost_micro_usd is null or cost_micro_usd >= 0),
    request_id text,
    started_at text not null,
    completed_at text not null,
    duration_ms integer not null check (duration_ms >= 0),
    created_at text not null,
    check (status != 'succeeded' or error_code is null)
  ) strict`,
  `insert into provider_calls (
    id, baseline_analysis_id, provider, model, operation, destination, endpoint_origin,
    status, error_code, redaction_applied, redaction_categories_json, input_tokens,
    output_tokens, total_tokens, cost_micro_usd, request_id, started_at, completed_at,
    duration_ms, created_at
  ) select
    id, analysis_id, provider, model, 'health-check', 'custom', null,
    status, null, 0, '[]', null, null, null, null, null, created_at, created_at, 0, created_at
  from provider_calls_0001`,
  'drop table provider_calls_0001',
  'create index provider_calls_baseline_analysis_id_idx on provider_calls(baseline_analysis_id)',
  `create table ai_enhancements (
    baseline_analysis_id text primary key references analyses(id) on delete cascade,
    schema_version text not null,
    config_fingerprint text not null,
    enhancement_json text not null check (json_valid(enhancement_json)),
    created_at text not null
  ) strict`,
] as const;

export const aiPersistenceMigration: Migration = Object.freeze({
  async up(database: Kysely<unknown>): Promise<void> {
    for (const statement of statements) await sql.raw(statement).execute(database);
  },
  down(): Promise<void> {
    return Promise.reject(new Error('Migration 0002 does not support rollback'));
  },
});

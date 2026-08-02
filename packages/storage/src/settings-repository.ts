import {
  LocalSettingsPatchSchema,
  LocalSettingsSchema,
  type LocalSettings,
  type LocalSettingsPatch,
} from '@roleproof/shared';
import type { Kysely, Transaction } from 'kysely';

import type { StorageDatabase } from './database.js';
import { StorageError } from './errors.js';
import type { SettingsTable, StorageSchema } from './schema.js';

export interface SettingsRepository {
  get(): Promise<LocalSettings>;
  update(settings: LocalSettingsPatch): Promise<LocalSettings>;
}

type DatabaseExecutor = Kysely<StorageSchema> | Transaction<StorageSchema>;

function fail(action: string, cause: unknown): never {
  if (cause instanceof StorageError) throw cause;
  throw new StorageError('REPOSITORY_FAILED', `Unable to ${action}`, { cause });
}

function validateSettings(value: unknown): LocalSettings {
  try {
    return LocalSettingsSchema.parse(value);
  } catch (cause) {
    throw new StorageError('VALIDATION_FAILED', 'Invalid local settings', { cause });
  }
}

function validateSettingsPatch(value: unknown): LocalSettingsPatch {
  try {
    return LocalSettingsPatchSchema.parse(value);
  } catch (cause) {
    throw new StorageError('VALIDATION_FAILED', 'Invalid local settings patch', { cause });
  }
}

function toSettings(row: SettingsTable | undefined): LocalSettings {
  if (row === undefined) return {};
  const settings: LocalSettings = {};
  if (row.provider !== null) settings.provider = row.provider;
  if (row.model !== null) settings.model = row.model;
  if (row.destination !== null) settings.destination = row.destination;
  if (row.base_url !== null) settings.baseUrl = row.base_url;
  if (row.default_export_format !== null) settings.defaultExportFormat = row.default_export_format;
  if (row.redact_employer !== null) settings.redactEmployer = row.redact_employer === 1;
  if (row.redact_clearance !== null) settings.redactClearance = row.redact_clearance === 1;
  if (row.redaction_terms_json !== null) {
    settings.redactionTerms = JSON.parse(row.redaction_terms_json) as string[];
  }
  if (row.max_total_tokens !== null) settings.maxTotalTokens = row.max_total_tokens;
  if (row.max_cost_usd !== null) settings.maxCostUsd = row.max_cost_usd;
  if (row.input_micro_usd_per_million_tokens !== null) {
    settings.inputMicroUsdPerMillionTokens = row.input_micro_usd_per_million_tokens;
  }
  if (row.output_micro_usd_per_million_tokens !== null) {
    settings.outputMicroUsdPerMillionTokens = row.output_micro_usd_per_million_tokens;
  }
  if (row.provider_timeout_ms !== null) settings.providerTimeoutMs = row.provider_timeout_ms;
  if (row.structured_output_mode !== null)
    settings.structuredOutputMode = row.structured_output_mode;
  return LocalSettingsSchema.parse(settings);
}

function settingsRow(settings: LocalSettings, now: string): Partial<SettingsTable> {
  return {
    provider: settings.provider ?? null,
    model: settings.model ?? null,
    destination: settings.destination ?? null,
    base_url: settings.baseUrl ?? null,
    default_export_format: settings.defaultExportFormat ?? null,
    redact_employer: settings.redactEmployer === undefined ? null : settings.redactEmployer ? 1 : 0,
    redact_clearance:
      settings.redactClearance === undefined ? null : settings.redactClearance ? 1 : 0,
    redaction_terms_json:
      settings.redactionTerms === undefined ? null : JSON.stringify(settings.redactionTerms),
    max_total_tokens: settings.maxTotalTokens ?? null,
    max_cost_usd: settings.maxCostUsd ?? null,
    input_micro_usd_per_million_tokens: settings.inputMicroUsdPerMillionTokens ?? null,
    output_micro_usd_per_million_tokens: settings.outputMicroUsdPerMillionTokens ?? null,
    provider_timeout_ms: settings.providerTimeoutMs ?? null,
    structured_output_mode: settings.structuredOutputMode ?? null,
    updated_at: now,
  };
}

function withoutNullValues(settings: LocalSettings): LocalSettings {
  const cleaned: LocalSettings = {};
  for (const [key, value] of Object.entries(settings)) {
    if (value !== null) (cleaned as Record<string, unknown>)[key] = value;
  }
  return cleaned;
}

export function createSettingsRepository(
  database: StorageDatabase,
  clock: () => Date,
): SettingsRepository {
  const now = () => clock().toISOString();
  const getRow = (executor: DatabaseExecutor) =>
    executor.selectFrom('settings').selectAll().where('id', '=', 1).executeTakeFirst();

  return {
    async get() {
      try {
        const row = await getRow(database);
        return toSettings(row);
      } catch (cause) {
        fail('get local settings', cause);
      }
    },

    async update(input) {
      try {
        const parsed = validateSettingsPatch(input);
        const current = await getRow(database);
        const merged = validateSettings({ ...toSettings(current), ...parsed });
        const row = settingsRow(merged, now());
        await database
          .insertInto('settings')
          .values({ id: 1, created_at: now(), updated_at: now(), ...row })
          .onConflict((conflict) => conflict.column('id').doUpdateSet(row))
          .execute();
        return withoutNullValues(merged);
      } catch (cause) {
        fail('update local settings', cause);
      }
    },
  };
}

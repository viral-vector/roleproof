import { randomUUID } from 'node:crypto';

import {
  AIEnhancementSchema,
  ProviderCallFailureInputSchema,
  StoredAIEnhancementSchema,
  StoredProviderCallSchema,
  type AIEnhancement,
  type ProviderCallFailureInput,
  type StoredAIEnhancement,
  type StoredProviderCall,
} from '@roleproof/shared';

import type { StorageDatabase } from './database.js';
import { StorageError } from './errors.js';
import type { AIEnhancementTable, ProviderCallTable } from './schema.js';

type Clock = () => Date;
const operations = ['analyze-requirements', 'map-evidence', 'suggest-application-changes'] as const;

export interface AIEnhancementRepository {
  save(enhancement: AIEnhancement, configFingerprint: string): Promise<StoredAIEnhancement>;
  get(baselineAnalysisId: string): Promise<StoredAIEnhancement | undefined>;
}

export interface ProviderCallRepository {
  recordFailure(input: ProviderCallFailureInput): Promise<StoredProviderCall>;
  list(baselineAnalysisId?: string): Promise<StoredProviderCall[]>;
}

function validate<T>(label: string, parse: () => T): T {
  try {
    return parse();
  } catch (cause) {
    throw new StorageError('VALIDATION_FAILED', `Invalid ${label}`, { cause });
  }
}

function fail(action: string, cause: unknown): never {
  if (cause instanceof StorageError) throw cause;
  throw new StorageError('REPOSITORY_FAILED', `Unable to ${action}`, { cause });
}

const callId = (): string => `provider-call-${randomUUID()}`;

function toCall(row: ProviderCallTable): StoredProviderCall {
  return StoredProviderCallSchema.parse({
    schemaVersion: '1.0',
    id: row.id,
    baselineAnalysisId: row.baseline_analysis_id,
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    destination: row.destination,
    endpointOrigin: row.endpoint_origin,
    status: row.status,
    errorCode: row.error_code,
    redactionApplied: row.redaction_applied === 1,
    redactionCategories: JSON.parse(row.redaction_categories_json) as unknown,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    costMicroUsd: row.cost_micro_usd,
    requestId: row.request_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  });
}

function toEnhancement(row: AIEnhancementTable): StoredAIEnhancement {
  return StoredAIEnhancementSchema.parse({
    schemaVersion: row.schema_version,
    baselineAnalysisId: row.baseline_analysis_id,
    configFingerprint: row.config_fingerprint,
    enhancement: JSON.parse(row.enhancement_json) as unknown,
    createdAt: row.created_at,
  });
}

function callInsert(call: StoredProviderCall): ProviderCallTable {
  return {
    id: call.id,
    baseline_analysis_id: call.baselineAnalysisId,
    provider: call.provider,
    model: call.model,
    operation: call.operation,
    destination: call.destination,
    endpoint_origin: call.endpointOrigin,
    status: call.status,
    error_code: call.errorCode,
    redaction_applied: call.redactionApplied ? 1 : 0,
    redaction_categories_json: JSON.stringify(call.redactionCategories),
    input_tokens: call.inputTokens,
    output_tokens: call.outputTokens,
    total_tokens: call.totalTokens,
    cost_micro_usd: call.costMicroUsd,
    request_id: call.requestId,
    started_at: call.startedAt,
    completed_at: call.completedAt,
    duration_ms: call.durationMs,
    created_at: call.createdAt,
  };
}

function successfulCall(
  baselineAnalysisId: string,
  execution: AIEnhancement['providerExecutions'][number],
  createdAt: string,
): StoredProviderCall {
  return StoredProviderCallSchema.parse({
    schemaVersion: '1.0',
    id: callId(),
    baselineAnalysisId,
    provider: execution.provider,
    model: execution.model,
    operation: execution.operation,
    destination: execution.destination,
    endpointOrigin: execution.manifest.endpointOrigin,
    status: 'succeeded',
    errorCode: null,
    redactionApplied: execution.manifest.redactionApplied,
    redactionCategories: [...execution.manifest.redactionSummary.categories].sort(),
    inputTokens: execution.usage.inputTokens,
    outputTokens: execution.usage.outputTokens,
    totalTokens: execution.usage.totalTokens,
    costMicroUsd: execution.usage.costMicroUsd,
    requestId: execution.requestId ?? null,
    startedAt: createdAt,
    completedAt: createdAt,
    durationMs: 0,
    createdAt,
  });
}

async function requireBaseline(database: StorageDatabase, id: string): Promise<void> {
  const baseline = await database
    .selectFrom('analyses')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  if (baseline === undefined)
    throw new StorageError('NOT_FOUND', 'Baseline analysis was not found');
}

export function createAIRepositories(
  database: StorageDatabase,
  clock: Clock,
): {
  aiEnhancements: AIEnhancementRepository;
  providerCalls: ProviderCallRepository;
} {
  const providerCalls: ProviderCallRepository = {
    async recordFailure(input) {
      try {
        const value = validate('provider call failure', () =>
          ProviderCallFailureInputSchema.parse(input),
        );
        await requireBaseline(database, value.baselineAnalysisId);
        const createdAt = clock().toISOString();
        const failedExecution = value.failedExecution;
        const failureManifest = failedExecution?.manifest ?? value.manifest;
        const withoutId = {
          schemaVersion: '1.0' as const,
          baselineAnalysisId: value.baselineAnalysisId,
          provider: value.provider,
          model: value.model,
          operation: value.operation,
          destination: value.destination,
          endpointOrigin: failureManifest?.endpointOrigin ?? value.endpointOrigin,
          status: 'failed' as const,
          errorCode: value.errorCode,
          redactionApplied: failureManifest?.redactionApplied ?? false,
          redactionCategories: [...(failureManifest?.redactionSummary.categories ?? [])].sort(),
          inputTokens: failedExecution?.usage.inputTokens ?? null,
          outputTokens: failedExecution?.usage.outputTokens ?? null,
          totalTokens: failedExecution?.usage.totalTokens ?? null,
          costMicroUsd: failedExecution?.usage.costMicroUsd ?? null,
          requestId: failedExecution?.requestId ?? value.requestId,
          startedAt: value.startedAt,
          completedAt: value.completedAt,
          durationMs: value.durationMs,
          createdAt,
        };
        const call = StoredProviderCallSchema.parse({ ...withoutId, id: callId() });
        const completed = (value.completedExecutions ?? []).map((execution) =>
          successfulCall(value.baselineAnalysisId, execution, createdAt),
        );
        await database.transaction().execute(async (transaction) => {
          for (const completedCall of completed) {
            await transaction
              .insertInto('provider_calls')
              .values(callInsert(completedCall))
              .execute();
          }
          await transaction.insertInto('provider_calls').values(callInsert(call)).execute();
        });
        return call;
      } catch (cause) {
        fail('record provider call failure', cause);
      }
    },

    async list(baselineAnalysisId) {
      try {
        let query = database.selectFrom('provider_calls').selectAll();
        if (baselineAnalysisId !== undefined) {
          query = query.where('baseline_analysis_id', '=', baselineAnalysisId);
        }
        const rows = await query.orderBy('started_at').orderBy('operation').orderBy('id').execute();
        return rows.map(toCall);
      } catch (cause) {
        fail('list provider calls', cause);
      }
    },
  };

  const aiEnhancements: AIEnhancementRepository = {
    async save(input, configFingerprint) {
      try {
        const enhancement = validate('AI enhancement', () => AIEnhancementSchema.parse(input));
        await requireBaseline(database, enhancement.baselineAnalysisId);
        const existing = await database
          .selectFrom('ai_enhancements')
          .select('baseline_analysis_id')
          .where('baseline_analysis_id', '=', enhancement.baselineAnalysisId)
          .executeTakeFirst();
        if (existing !== undefined) {
          throw new StorageError(
            'VALIDATION_FAILED',
            'AI enhancement is immutable and already exists',
          );
        }

        const executions = enhancement.providerExecutions;
        const actualOperations = executions.map(({ operation }) => operation).sort();
        const expectedOperations = [...operations].sort();
        const first = executions[0];
        if (
          executions.length !== 3 ||
          JSON.stringify(actualOperations) !== JSON.stringify(expectedOperations) ||
          first === undefined ||
          executions.some(
            (execution) =>
              execution.errorCode !== null ||
              execution.provider !== first.provider ||
              execution.model !== first.model ||
              execution.destination !== first.destination ||
              execution.manifest.provider !== execution.provider ||
              execution.manifest.model !== execution.model ||
              execution.manifest.destination !== execution.destination,
          )
        ) {
          throw new StorageError(
            'VALIDATION_FAILED',
            'AI enhancement requires exactly one successful execution for each enhancement operation using one provider configuration',
          );
        }

        const createdAt = clock().toISOString();
        const stored = StoredAIEnhancementSchema.parse({
          schemaVersion: enhancement.schemaVersion,
          baselineAnalysisId: enhancement.baselineAnalysisId,
          configFingerprint,
          enhancement,
          createdAt,
        });
        const calls = executions.map((execution) => {
          return successfulCall(enhancement.baselineAnalysisId, execution, createdAt);
        });

        await database.transaction().execute(async (transaction) => {
          await transaction
            .insertInto('ai_enhancements')
            .values({
              baseline_analysis_id: stored.baselineAnalysisId,
              schema_version: stored.schemaVersion,
              config_fingerprint: stored.configFingerprint,
              enhancement_json: JSON.stringify(stored.enhancement),
              created_at: stored.createdAt,
            })
            .execute();
          for (const call of calls) {
            await transaction.insertInto('provider_calls').values(callInsert(call)).execute();
          }
        });
        return stored;
      } catch (cause) {
        fail('save AI enhancement', cause);
      }
    },

    async get(baselineAnalysisId) {
      try {
        const row = await database
          .selectFrom('ai_enhancements')
          .selectAll()
          .where('baseline_analysis_id', '=', baselineAnalysisId)
          .executeTakeFirst();
        return row === undefined ? undefined : toEnhancement(row);
      } catch (cause) {
        fail('get AI enhancement', cause);
      }
    },
  };

  return { aiEnhancements, providerCalls };
}

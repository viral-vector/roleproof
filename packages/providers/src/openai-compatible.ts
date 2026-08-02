import type {
  ApplicationSuggestionInput,
  ApplicationSuggestionOutput,
  EvidenceMappingInput,
  EvidenceMappingOutput,
  LocalProviderModel,
  ProviderConfig,
  ProviderHealth,
  ProviderOperation,
  RequirementAnalysisInput,
  RequirementAnalysisOutput,
} from '@roleproof/shared';

import {
  OUTPUT_JSON_SCHEMAS,
  SYSTEM_PROMPT,
  assertContext,
  executionMetadata,
  fetchJson,
  healthResult,
  normalizeUsage,
  parseConfig,
  parseCredentials,
  parseOperationOutput,
  type OperationOutput,
  type ProviderCredentials,
} from './adapter-common.js';
import { ProviderError } from './errors.js';
import { assertTrustedProviderCallContext } from './context.js';
import type { AIProvider, ProviderCallContext, ProviderResult } from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isLoopback = (hostname: string): boolean => {
  const normalized = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return true;
  const octets = normalized.split('.');
  return (
    octets.length === 4 &&
    octets.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255) &&
    octets[0] === '127'
  );
};

function operationOutputInstruction(operation: Exclude<ProviderOperation, 'health-check'>): string {
  const examples = {
    'analyze-requirements': {
      requirements: [
        {
          requirementId: 'req-id-from-input',
          baselineClassification: 'direct',
          classification: 'direct',
          evidenceIds: ['evidence-id-from-input'],
          explanation: 'Short evidence-based explanation.',
        },
      ],
    },
    'map-evidence': {
      mappings: [
        {
          requirementId: 'req-id-from-input',
          baselineClassification: 'direct',
          classification: 'direct',
          evidenceIds: ['evidence-id-from-input'],
          explanation: 'Short evidence-based explanation.',
        },
      ],
    },
    'suggest-application-changes': {
      suggestedEmphasis: [
        {
          text: 'Evidence-linked emphasis.',
          classification: 'direct',
          evidenceIds: ['evidence-id-from-input'],
          explanation: 'Short evidence-based explanation.',
        },
      ],
      suggestedAdditions: [],
      interviewTopics: [
        {
          topic: 'Interview topic.',
          evidenceIds: ['evidence-id-from-input'],
          rationale: 'Why this topic follows from the supplied evidence.',
        },
      ],
      coverLetterAngles: [
        { text: 'Evidence-linked angle.', evidenceIds: ['evidence-id-from-input'] },
      ],
    },
  } satisfies Record<Exclude<ProviderOperation, 'health-check'>, unknown>;
  const commonRequirementRules =
    'Each requirement object must have exactly these keys: requirementId, baselineClassification, classification, evidenceIds, explanation. classification must be one of direct, strongly-related, partially-related, unsupported, unknown, requires-user-confirmation. Copy requirementId, baselineClassification, and evidenceIds from the matching input requirement unless evidenceIds is empty.';
  const operationRules =
    operation === 'suggest-application-changes'
      ? 'Use exactly these top-level keys: suggestedEmphasis, suggestedAdditions, interviewTopics, coverLetterAngles. Use empty arrays when there is no safe evidence-linked suggestion.'
      : `Use exactly one top-level key: ${operation === 'map-evidence' ? 'mappings' : 'requirements'}. ${commonRequirementRules}`;
  return `Return only a valid JSON object for ${operation}. Return an instance matching this output contract, not the contract itself. ${operationRules} Output contract example: ${JSON.stringify(
    examples[operation],
  )}. Do not return a JSON Schema. Do not echo the input. Do not add keys outside this contract.`;
}

function inputIds(value: unknown, collection: string, idKey: string): string[] {
  if (!isRecord(value) || !Array.isArray(value[collection])) return [];
  return [
    ...new Set(
      value[collection]
        .filter(isRecord)
        .map((item) => item[idKey])
        .filter((id): id is string => typeof id === 'string'),
    ),
  ].sort();
}

function nestedEvidenceIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.requirements)) return [];
  return [
    ...new Set(
      value.requirements
        .filter(isRecord)
        .flatMap((item) => (Array.isArray(item.evidenceIds) ? item.evidenceIds : []))
        .filter((id): id is string => typeof id === 'string'),
    ),
  ].sort();
}

function itemProperties(schema: unknown, collection: string): Record<string, unknown> | null {
  if (!isRecord(schema) || !isRecord(schema.properties)) return null;
  const arraySchema = schema.properties[collection];
  if (!isRecord(arraySchema) || !isRecord(arraySchema.items)) return null;
  return isRecord(arraySchema.items.properties) ? arraySchema.items.properties : null;
}

function constrainIds(
  schema: unknown,
  collection: string,
  field: string,
  allowedIds: readonly string[],
): void {
  const properties = itemProperties(schema, collection);
  if (properties === null || !isRecord(properties[field])) return;
  const fieldSchema = properties[field];
  if (field === 'evidenceIds') {
    if (allowedIds.length === 0) {
      fieldSchema.maxItems = 0;
    } else if (isRecord(fieldSchema.items)) {
      fieldSchema.items.enum = [...allowedIds];
    }
    return;
  }
  fieldSchema.enum = [...allowedIds];
}

function constrainedOutputSchema(
  operation: Exclude<ProviderOperation, 'health-check'>,
  input: unknown,
): unknown {
  const schema: unknown = structuredClone(OUTPUT_JSON_SCHEMAS[operation]);
  const requirementIds = inputIds(input, 'requirements', 'requirementId');
  const evidenceIds =
    operation === 'analyze-requirements'
      ? nestedEvidenceIds(input)
      : inputIds(input, 'evidence', 'evidenceId');
  const collections =
    operation === 'analyze-requirements'
      ? ['requirements']
      : operation === 'map-evidence'
        ? ['mappings']
        : ['suggestedEmphasis', 'suggestedAdditions', 'interviewTopics', 'coverLetterAngles'];
  for (const collection of collections) {
    if (operation !== 'suggest-application-changes') {
      constrainIds(schema, collection, 'requirementId', requirementIds);
    }
    constrainIds(schema, collection, 'evidenceIds', evidenceIds);
  }
  return schema;
}

function idAliases(ids: readonly string[], prefix: string): {
  toAlias: ReadonlyMap<string, string>;
  fromAlias: ReadonlyMap<string, string>;
} {
  const toAlias = new Map(ids.map((id, index) => [id, `${prefix}${String(index + 1)}`]));
  return {
    toAlias,
    fromAlias: new Map([...toAlias].map(([id, alias]) => [alias, id])),
  };
}

function replaceId(record: Record<string, unknown>, field: string, ids: ReadonlyMap<string, string>) {
  const value = record[field];
  if (typeof value === 'string') record[field] = ids.get(value) ?? value;
}

function replaceEvidenceIds(record: Record<string, unknown>, ids: ReadonlyMap<string, string>) {
  if (!Array.isArray(record.evidenceIds)) return;
  record.evidenceIds = record.evidenceIds.map((id) =>
    typeof id === 'string' ? (ids.get(id) ?? id) : id,
  );
}

function replaceCollectionIds(
  value: Record<string, unknown>,
  collection: string,
  requirementIds: ReadonlyMap<string, string>,
  evidenceIds: ReadonlyMap<string, string>,
) {
  if (!Array.isArray(value[collection])) return;
  for (const item of value[collection]) {
    if (!isRecord(item)) continue;
    replaceId(item, 'requirementId', requirementIds);
    replaceId(item, 'evidenceId', evidenceIds);
    replaceEvidenceIds(item, evidenceIds);
  }
}

function aliasProviderInput(input: unknown): {
  input: unknown;
  restoreOutput: (output: unknown) => unknown;
} {
  const requirementAliases = idAliases(inputIds(input, 'requirements', 'requirementId'), 'r');
  const evidenceIds = [
    ...new Set([...nestedEvidenceIds(input), ...inputIds(input, 'evidence', 'evidenceId')]),
  ].sort();
  const evidenceAliases = idAliases(evidenceIds, 'e');
  const aliasedInput: unknown = structuredClone(input);
  if (isRecord(aliasedInput)) {
    replaceCollectionIds(
      aliasedInput,
      'requirements',
      requirementAliases.toAlias,
      evidenceAliases.toAlias,
    );
    replaceCollectionIds(
      aliasedInput,
      'evidence',
      requirementAliases.toAlias,
      evidenceAliases.toAlias,
    );
  }
  return {
    input: aliasedInput,
    restoreOutput(output: unknown): unknown {
      const restored: unknown = structuredClone(output);
      if (!isRecord(restored)) return restored;
      for (const collection of [
        'requirements',
        'mappings',
        'suggestedEmphasis',
        'suggestedAdditions',
        'interviewTopics',
        'coverLetterAngles',
      ]) {
        replaceCollectionIds(
          restored,
          collection,
          requirementAliases.fromAlias,
          evidenceAliases.fromAlias,
        );
      }
      return restored;
    },
  };
}

function preserveDeterministicClassifications(
  operation: Exclude<ProviderOperation, 'health-check'>,
  input: unknown,
  output: unknown,
): unknown {
  if (operation === 'suggest-application-changes' || !isRecord(input) || !isRecord(output)) {
    return output;
  }
  if (!Array.isArray(input.requirements)) return output;
  const baselines = new Map<string, string>();
  for (const requirement of input.requirements) {
    if (
      isRecord(requirement) &&
      typeof requirement.requirementId === 'string' &&
      typeof requirement.baselineClassification === 'string'
    ) {
      baselines.set(requirement.requirementId, requirement.baselineClassification);
    }
  }
  const normalized: unknown = structuredClone(output);
  if (!isRecord(normalized)) return normalized;
  const collection = normalized[operation === 'map-evidence' ? 'mappings' : 'requirements'];
  if (!Array.isArray(collection)) return normalized;
  for (const item of collection) {
    if (!isRecord(item) || typeof item.requirementId !== 'string') continue;
    const baseline = baselines.get(item.requirementId);
    if (baseline === undefined) continue;
    if (typeof item.baselineClassification === 'string') item.baselineClassification = baseline;
    if (typeof item.classification === 'string') item.classification = baseline;
  }
  return normalized;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = 'openai-compatible' as const;
  readonly config: Readonly<ProviderConfig>;
  readonly endpointOrigin: string;
  readonly #apiKey: string | null;
  readonly #fetch: typeof fetch;
  readonly #completionsUrl: string;
  readonly #modelsUrl: string;

  constructor(
    config: ProviderConfig,
    credentials: ProviderCredentials | null,
    fetchImpl: typeof fetch = fetch,
  ) {
    const parsed = parseConfig(config, 'health-check');
    if (parsed.provider !== 'openai-compatible' || parsed.baseUrl === null) {
      throw new ProviderError('configuration', 'health-check');
    }
    const url = new URL(parsed.baseUrl);
    if (
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      !['http:', 'https:'].includes(url.protocol) ||
      (parsed.destination === 'local' && !isLoopback(url.hostname)) ||
      (parsed.destination !== 'local' && url.protocol !== 'https:')
    ) {
      throw new ProviderError('configuration', 'health-check');
    }
    const canonical = url.toString().replace(/\/$/u, '');
    this.config = Object.freeze({ ...parsed, baseUrl: canonical });
    this.endpointOrigin = url.origin;
    this.#completionsUrl = `${canonical}/chat/completions`;
    this.#modelsUrl = `${canonical}/models`;
    this.#apiKey = parseCredentials(credentials, parsed.destination !== 'local')?.apiKey ?? null;
    this.#fetch = fetchImpl;
  }

  analyzeRequirements(
    context: ProviderCallContext<RequirementAnalysisInput>,
  ): Promise<ProviderResult<RequirementAnalysisOutput>> {
    return this.#call('analyze-requirements', context);
  }
  mapEvidence(
    context: ProviderCallContext<EvidenceMappingInput>,
  ): Promise<ProviderResult<EvidenceMappingOutput>> {
    return this.#call('map-evidence', context);
  }
  suggestApplicationChanges(
    context: ProviderCallContext<ApplicationSuggestionInput>,
  ): Promise<ProviderResult<ApplicationSuggestionOutput>> {
    return this.#call('suggest-application-changes', context);
  }

  async #call<T extends OperationOutput>(
    operation: Exclude<ProviderOperation, 'health-check'>,
    context: ProviderCallContext<unknown>,
  ): Promise<ProviderResult<T>> {
    assertTrustedProviderCallContext(context);
    const originalInput = JSON.stringify(context.input);
    assertContext(this.config, this.endpointOrigin, context.manifest, originalInput, operation);
    const aliases = aliasProviderInput(context.input);
    const serializedInput = JSON.stringify(aliases.input);
    const responseFormat =
      this.config.structuredOutputMode === 'json-schema'
        ? {
            type: 'json_schema',
            json_schema: {
              name: operation.replaceAll('-', '_'),
              strict: true,
              schema: constrainedOutputSchema(operation, aliases.input),
            },
          }
        : { type: 'json_object' };
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.#apiKey !== null) headers.authorization = `Bearer ${this.#apiKey}`;
    const response = await fetchJson(
      this.#fetch,
      this.#completionsUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'system', content: operationOutputInstruction(operation) },
            { role: 'user', content: serializedInput },
          ],
          response_format: responseFormat,
          temperature: 0,
          max_tokens: this.config.maxOutputTokens,
        }),
      },
      this.config.requestTimeoutMs,
      operation,
    );
    const parsed = this.#parseResponse(operation, response.value);
    const restored = aliases.restoreOutput(parsed.output);
    return {
      output: parseOperationOutput<T>(
        operation,
        preserveDeterministicClassifications(operation, context.input, restored),
      ),
      metadata: executionMetadata(
        this.config,
        operation,
        context.manifest,
        parsed.usage,
        response.requestId,
      ),
    };
  }

  #parseResponse(operation: ProviderOperation, value: unknown) {
    if (
      !isRecord(value) ||
      !Array.isArray(value.choices) ||
      value.choices.length !== 1
    ) {
      throw new ProviderError('invalid-output', operation);
    }
    const choice = (value.choices as unknown[])[0];
    if (!isRecord(choice) || !isRecord(choice.message))
      throw new ProviderError('invalid-output', operation);
    if (typeof choice.message.refusal === 'string') throw new ProviderError('refusal', operation);
    if (choice.finish_reason !== 'stop') {
      if (choice.finish_reason === 'length') throw new ProviderError('incomplete', operation);
      throw new ProviderError('refusal', operation);
    }
    if (typeof choice.message.content !== 'string')
      throw new ProviderError('invalid-output', operation);
    let output: unknown;
    try {
      output = JSON.parse(choice.message.content);
    } catch {
      throw new ProviderError('invalid-output', operation);
    }
    const usageValue = value.usage;
    if (usageValue !== undefined && !isRecord(usageValue))
      throw new ProviderError('invalid-output', operation);
    const usage =
      usageValue === undefined
        ? { inputTokens: null, outputTokens: null, totalTokens: null, costMicroUsd: null }
        : normalizeUsage(
            this.config,
            operation,
            usageValue.prompt_tokens,
            usageValue.completion_tokens,
            usageValue.total_tokens,
          );
    return { output, usage };
  }

  async healthCheck(): Promise<ProviderResult<ProviderHealth>> {
    try {
      const response = await this.listModels();
      const configuredModel = response.output.models.find(
        (model) => model.id === this.config.model,
      );
      const modelAvailable = configuredModel !== undefined;
      const structuredOutputSupported = configuredModel?.structuredOutputSupported ?? null;
      return healthResult(
        this.config,
        this.#modelsUrl,
        modelAvailable ? 'healthy' : 'degraded',
        null,
        modelAvailable,
        structuredOutputSupported,
        response.metadata.requestId,
      );
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : 'unavailable';
      return healthResult(this.config, this.#modelsUrl, 'unavailable', code, null, null);
    }
  }

  async listModels(): Promise<ProviderResult<{ models: readonly LocalProviderModel[] }>> {
    const headers: Record<string, string> = {};
    if (this.#apiKey !== null) headers.authorization = `Bearer ${this.#apiKey}`;
    const response = await fetchJson(
      this.#fetch,
      this.#modelsUrl,
      { method: 'GET', headers },
      this.config.requestTimeoutMs,
      'health-check',
    );
    const rawModels =
      isRecord(response.value) && Array.isArray(response.value.data) ? response.value.data : [];
    const models = rawModels
      .filter(
        (model): model is Record<string, unknown> =>
          isRecord(model) && typeof model.id === 'string',
      )
      .map((model) => {
        const capabilities = isRecord(model.capabilities) ? model.capabilities : undefined;
        return {
          id: model.id as string,
          structuredOutputSupported:
            capabilities !== undefined && typeof capabilities.structured_outputs === 'boolean'
              ? capabilities.structured_outputs
              : null,
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    return {
      output: { models },
      metadata: executionMetadata(
        this.config,
        'health-check',
        {
          provider: this.config.provider,
          model: this.config.model,
          destination: this.config.destination,
          endpointOrigin: this.endpointOrigin,
          dataCategories: [],
          redactionApplied: true,
          redactionSummary: { categories: [], replacementCount: 0, inputChars: 0, outputChars: 0 },
        },
        { inputTokens: null, outputTokens: null, totalTokens: null, costMicroUsd: null },
        response.requestId,
      ),
    };
  }
}

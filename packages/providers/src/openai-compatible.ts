import type {
  ApplicationSuggestionInput,
  ApplicationSuggestionOutput,
  EvidenceMappingInput,
  EvidenceMappingOutput,
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
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));
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
    const serializedInput = JSON.stringify(context.input);
    assertContext(this.config, this.endpointOrigin, context.manifest, serializedInput, operation);
    const responseFormat =
      this.config.structuredOutputMode === 'json-schema'
        ? {
            type: 'json_schema',
            json_schema: {
              name: operation.replaceAll('-', '_'),
              strict: true,
              schema: OUTPUT_JSON_SCHEMAS[operation],
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
            { role: 'user', content: serializedInput },
          ],
          response_format: responseFormat,
          max_tokens: this.config.maxOutputTokens,
        }),
      },
      this.config.requestTimeoutMs,
      operation,
    );
    const parsed = this.#parseResponse<T>(operation, response.value);
    return {
      output: parsed.output,
      metadata: executionMetadata(
        this.config,
        operation,
        context.manifest,
        parsed.usage,
        response.requestId,
      ),
    };
  }

  #parseResponse<T>(operation: ProviderOperation, value: unknown) {
    if (
      !isRecord(value) ||
      !hasOnly(value, [
        'id',
        'object',
        'created',
        'model',
        'choices',
        'usage',
        'system_fingerprint',
      ]) ||
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
    const usage = normalizeUsage(
      this.config,
      operation,
      isRecord(usageValue) ? usageValue.prompt_tokens : null,
      isRecord(usageValue) ? usageValue.completion_tokens : null,
      isRecord(usageValue) ? usageValue.total_tokens : null,
    );
    return { output: parseOperationOutput<T>(operation, output), usage };
  }

  async healthCheck(): Promise<ProviderResult<ProviderHealth>> {
    const headers: Record<string, string> = {};
    if (this.#apiKey !== null) headers.authorization = `Bearer ${this.#apiKey}`;
    try {
      const response = await fetchJson(
        this.#fetch,
        this.#modelsUrl,
        { method: 'GET', headers },
        this.config.requestTimeoutMs,
        'health-check',
      );
      const models: unknown[] =
        isRecord(response.value) && Array.isArray(response.value.data)
          ? (response.value.data as unknown[])
          : [];
      const modelAvailable = models.some(
        (model) => isRecord(model) && model.id === this.config.model,
      );
      const configuredModel = models.find(
        (model) => isRecord(model) && model.id === this.config.model,
      );
      const capabilities = isRecord(configuredModel) ? configuredModel.capabilities : undefined;
      const structuredOutputSupported =
        isRecord(capabilities) && typeof capabilities.structured_outputs === 'boolean'
          ? capabilities.structured_outputs
          : null;
      return healthResult(
        this.config,
        this.#modelsUrl,
        modelAvailable ? 'healthy' : 'degraded',
        null,
        modelAvailable,
        structuredOutputSupported,
        response.requestId,
      );
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : 'unavailable';
      return healthResult(this.config, this.#modelsUrl, 'unavailable', code, null, null);
    }
  }
}

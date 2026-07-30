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

const BASE_URL = 'https://api.openai.com/v1';
const RESPONSES_URL = `${BASE_URL}/responses`;
const MODELS_URL = `${BASE_URL}/models`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const;
  readonly config: Readonly<ProviderConfig>;
  readonly endpointOrigin = new URL(BASE_URL).origin;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(
    config: ProviderConfig,
    credentials: ProviderCredentials,
    fetchImpl: typeof fetch = fetch,
  ) {
    const parsed = parseConfig(config, 'health-check');
    if (
      parsed.provider !== 'openai' ||
      parsed.destination !== 'hosted' ||
      parsed.baseUrl !== null ||
      parsed.structuredOutputMode !== 'json-schema'
    ) {
      throw new ProviderError('configuration', 'health-check');
    }
    this.config = Object.freeze(parsed);
    this.#apiKey = parseCredentials(credentials, true)!.apiKey;
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
    const body = JSON.stringify({
      model: this.config.model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
        { role: 'user', content: [{ type: 'input_text', text: serializedInput }] },
      ],
      store: false,
      max_output_tokens: this.config.maxOutputTokens,
      text: {
        format: {
          type: 'json_schema',
          name: operation.replaceAll('-', '_'),
          strict: true,
          schema: OUTPUT_JSON_SCHEMAS[operation],
        },
      },
    });
    const response = await fetchJson(
      this.#fetch,
      RESPONSES_URL,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json' },
        body,
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
    if (!isRecord(value)) {
      throw new ProviderError('invalid-output', operation);
    }
    if (value.status === 'incomplete') throw new ProviderError('incomplete', operation);
    if (value.status !== 'completed' || !Array.isArray(value.output)) {
      throw new ProviderError('invalid-output', operation);
    }
    let outputText: string | null = null;
    for (const item of value.output) {
      if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (!isRecord(content)) continue;
        if (content.type === 'refusal') throw new ProviderError('refusal', operation);
        if (content.type === 'output_text' && typeof content.text === 'string')
          outputText = content.text;
      }
    }
    if (outputText === null) throw new ProviderError('invalid-output', operation);
    let output: unknown;
    try {
      output = JSON.parse(outputText);
    } catch {
      throw new ProviderError('invalid-output', operation);
    }
    const usageValue = value.usage;
    if (usageValue !== undefined && !isRecord(usageValue)) {
      throw new ProviderError('invalid-output', operation);
    }
    const usage = normalizeUsage(
      this.config,
      operation,
      isRecord(usageValue) ? usageValue.input_tokens : null,
      isRecord(usageValue) ? usageValue.output_tokens : null,
      isRecord(usageValue) ? usageValue.total_tokens : null,
    );
    return { output: parseOperationOutput<T>(operation, output), usage };
  }

  async healthCheck(): Promise<ProviderResult<ProviderHealth>> {
    try {
      const response = await fetchJson(
        this.#fetch,
        MODELS_URL,
        { method: 'GET', headers: { authorization: `Bearer ${this.#apiKey}` } },
        this.config.requestTimeoutMs,
        'health-check',
      );
      const modelAvailable =
        isRecord(response.value) &&
        Array.isArray(response.value.data) &&
        response.value.data.some((model) => isRecord(model) && model.id === this.config.model);
      return healthResult(
        this.config,
        MODELS_URL,
        modelAvailable ? 'healthy' : 'degraded',
        null,
        modelAvailable,
        true,
        response.requestId,
      );
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : 'unavailable';
      return healthResult(this.config, MODELS_URL, 'unavailable', code, null, null);
    }
  }
}

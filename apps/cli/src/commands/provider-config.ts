import {
  OpenAICompatibleProvider,
  OpenAIProvider,
  ProviderError,
  createProviderConfig,
  type AIProvider,
} from '@roleproof/providers';
import type { ProviderConfig, ProviderDestination, ProviderId } from '@roleproof/shared';

import { CliError } from '../errors.js';

export interface ProviderCliOptions {
  provider?: ProviderId | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  destination?: ProviderDestination | undefined;
  structuredOutputMode?: 'json-schema' | 'json-object' | undefined;
  providerTimeoutMs?: number | undefined;
  maxInputChars?: number | undefined;
  maxOutputTokens?: number | undefined;
  maxTotalTokens?: number | undefined;
  maxCostUsd?: number | undefined;
  inputCostPerMillionUsd?: number | undefined;
  outputCostPerMillionUsd?: number | undefined;
  redactEmployer?: boolean | undefined;
  redactClearance?: boolean | undefined;
  redactTerm?: string[] | undefined;
}

const microUsd = (value: number, label: string): number => {
  const converted = Math.round(value * 1_000_000);
  if (!Number.isSafeInteger(converted) || converted < 0) {
    throw new CliError(2, `${label} cannot be represented safely in micro-USD.`);
  }
  return converted;
};

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

function validateCompatibleDestination(options: ProviderCliOptions): void {
  if (options.provider !== 'openai-compatible' || options.baseUrl === undefined) return;
  let endpoint: URL;
  try {
    endpoint = new URL(options.baseUrl);
  } catch {
    throw new CliError(2, 'OpenAI-compatible base URL is invalid.');
  }
  if (
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== '' ||
    !['http:', 'https:'].includes(endpoint.protocol)
  ) {
    throw new CliError(
      2,
      'OpenAI-compatible base URL must be HTTP(S) without credentials, query, or fragment.',
    );
  }
  if (options.destination === 'local' && !isLoopback(endpoint.hostname)) {
    throw new CliError(2, 'A local provider destination requires a loopback endpoint.');
  }
  if (options.destination !== 'local' && endpoint.protocol !== 'https:') {
    throw new CliError(2, 'Hosted and custom provider destinations require HTTPS.');
  }
}

export function buildProviderConfig(options: ProviderCliOptions): ProviderConfig {
  if (options.provider === undefined || options.model === undefined) {
    throw new CliError(2, '--provider and --model are required together.');
  }
  validateCompatibleDestination(options);
  try {
    return createProviderConfig({
      provider: options.provider,
      model: options.model,
      destination: options.provider === 'openai' ? 'hosted' : options.destination!,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.providerTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.providerTimeoutMs }),
      ...(options.maxInputChars === undefined ? {} : { maxInputChars: options.maxInputChars }),
      ...(options.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: options.maxOutputTokens }),
      ...(options.maxTotalTokens === undefined ? {} : { maxTotalTokens: options.maxTotalTokens }),
      ...(options.maxCostUsd === undefined
        ? {}
        : { maxCostMicroUsd: microUsd(options.maxCostUsd, 'Maximum cost') }),
      ...(options.inputCostPerMillionUsd === undefined ||
      options.outputCostPerMillionUsd === undefined
        ? {}
        : {
            rates: {
              inputMicroUsdPerMillionTokens: microUsd(options.inputCostPerMillionUsd, 'Input rate'),
              outputMicroUsdPerMillionTokens: microUsd(
                options.outputCostPerMillionUsd,
                'Output rate',
              ),
            },
          }),
      ...(options.structuredOutputMode === undefined
        ? {}
        : { structuredOutputMode: options.structuredOutputMode }),
      redaction: {
        confidentialEmployerNames: options.redactEmployer ?? false,
        clearanceDetails: options.redactClearance ?? false,
        userSelectedTerms: options.redactTerm ?? [],
      },
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(2, 'Provider configuration is invalid. Check endpoint and limit options.');
  }
}

export function createConfiguredProvider(config: ProviderConfig): AIProvider {
  const variable = config.provider === 'openai' ? 'OPENAI_API_KEY' : 'ROLEPROOF_PROVIDER_API_KEY';
  const apiKey = process.env[variable];
  const credentials = apiKey === undefined || apiKey.trim() === '' ? null : { apiKey };
  try {
    if (config.provider === 'openai') {
      if (credentials === null) throw new CliError(2, 'OPENAI_API_KEY is required for OpenAI.');
      return new OpenAIProvider(config, credentials);
    }
    return new OpenAICompatibleProvider(config, credentials);
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'configuration') {
      if (credentials === null && config.destination !== 'local') {
        throw new CliError(2, `${variable} is required for this provider destination.`);
      }
      throw new CliError(2, 'Provider endpoint configuration is invalid.');
    }
    throw error;
  }
}

export function addProviderOptions(
  command: import('commander').Command,
): import('commander').Command {
  return command
    .requiredOption('--provider <provider>', 'Provider: openai or openai-compatible')
    .requiredOption('--model <model>', 'Provider model')
    .option('--base-url <url>', 'OpenAI-compatible API base URL')
    .option('--destination <destination>', 'Destination: hosted, local, or custom')
    .option('--structured-output-mode <mode>', 'Structured output: json-schema or json-object')
    .option('--provider-timeout-ms <number>', 'Provider request timeout')
    .option('--max-input-chars <number>', 'Maximum provider input characters')
    .option('--max-output-tokens <number>', 'Maximum output tokens')
    .option('--max-total-tokens <number>', 'Maximum aggregate tokens')
    .option('--max-cost-usd <number>', 'Maximum cost in USD')
    .option('--input-cost-per-million-usd <number>', 'Input rate per million tokens')
    .option('--output-cost-per-million-usd <number>', 'Output rate per million tokens');
}

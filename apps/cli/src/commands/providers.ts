import { CommandEnvelopeSchema } from '@roleproof/shared';
import type { Command } from 'commander';
import { z } from 'zod';

import { CliError } from '../errors.js';
import type { CliOutput, CliState } from '../program.js';
import {
  addProviderOptions,
  buildProviderConfig,
  createConfiguredProvider,
  type ProviderCliOptions,
} from './provider-config.js';

const HealthOptionsSchema = z
  .object({
    provider: z.enum(['openai', 'openai-compatible']),
    model: z.string().min(1),
    baseUrl: z.string().min(1).optional(),
    destination: z.enum(['hosted', 'local', 'custom']).optional(),
    structuredOutputMode: z.enum(['json-schema', 'json-object']).optional(),
    providerTimeoutMs: z.coerce.number().finite().int().positive().optional(),
    maxInputChars: z.coerce.number().finite().int().positive().optional(),
    maxOutputTokens: z.coerce.number().finite().int().positive().optional(),
    maxTotalTokens: z.coerce.number().finite().int().positive().optional(),
    maxCostUsd: z.coerce.number().finite().nonnegative().optional(),
    inputCostPerMillionUsd: z.coerce.number().finite().nonnegative().optional(),
    outputCostPerMillionUsd: z.coerce.number().finite().nonnegative().optional(),
    format: z.enum(['text', 'json']),
  })
  .strict()
  .superRefine((options, context) => {
    if (
      options.provider === 'openai' &&
      (options.baseUrl !== undefined ||
        (options.destination !== undefined && options.destination !== 'hosted') ||
        options.structuredOutputMode === 'json-object')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'OpenAI uses its fixed hosted JSON-schema endpoint',
      });
    }
    if (
      options.provider === 'openai-compatible' &&
      (options.baseUrl === undefined || options.destination === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'OpenAI-compatible providers require --base-url and --destination',
      });
    }
    if (
      (options.inputCostPerMillionUsd === undefined) !==
        (options.outputCostPerMillionUsd === undefined) ||
      (options.maxCostUsd !== undefined && options.inputCostPerMillionUsd === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Maximum cost requires both input and output rates',
      });
    }
  });

function writeJson(command: string, data: unknown, output: CliOutput): void {
  const envelope = CommandEnvelopeSchema.parse({ schemaVersion: '1.0', command, data });
  output.writeOut(`${JSON.stringify(envelope, null, 2)}\n`);
}

export function registerProviderCommands(
  program: Command,
  output: CliOutput,
  state: CliState,
): void {
  const providers = program.command('providers').description('Inspect and test AI providers');
  providers
    .command('list')
    .description('List supported providers')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: { format: string }) => {
      if (!['text', 'json'].includes(options.format))
        throw new CliError(2, 'Invalid format. Expected text or json.');
      const summaries = [
        {
          provider: 'openai' as const,
          model: 'user-selected',
          destination: 'hosted' as const,
          configured: false,
        },
        {
          provider: 'openai-compatible' as const,
          model: 'user-selected',
          destination: 'local' as const,
          configured: false,
        },
      ];
      if (options.format === 'json') writeJson('providers.list', { providers: summaries }, output);
      else output.writeOut('openai (hosted)\nopenai-compatible (local, hosted, or custom)\n');
    });

  addProviderOptions(
    providers.command('test').description('Test provider health without career data'),
  )
    .option('--format <format>', 'Output format: text or json', 'text')
    .action(async (rawOptions: unknown) => {
      const parsed = HealthOptionsSchema.safeParse(rawOptions);
      if (!parsed.success)
        throw new CliError(2, parsed.error.issues[0]?.message ?? 'Invalid provider options.');
      const config = buildProviderConfig(parsed.data as ProviderCliOptions);
      const result = await createConfiguredProvider(config).healthCheck();
      if (parsed.data.format === 'json')
        writeJson('providers.test', { health: result.output }, output);
      else {
        output.writeOut(
          `Provider: ${result.output.provider}\nDestination: ${result.output.destination}\nStatus: ${result.output.status}\n`,
        );
      }
      state.exitCode = result.output.status === 'healthy' ? 0 : 4;
    });
}

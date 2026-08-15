import { z } from 'zod';

import { DEFAULT_BATCH_CONFIG, DEFAULT_WEBHOOK_CONFIG } from '@roleproof/shared';

function isLocalWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export const AnalyzeOptionsSchema = z
  .object({
    resume: z.string().min(1).optional(),
    job: z.string().min(1).optional(),
    stdinResume: z.boolean().optional(),
    stdinJob: z.boolean().optional(),
    manifest: z.string().min(1).optional(),
    concurrency: z.coerce
      .number()
      .int()
      .min(1, `--concurrency must be between 1 and ${DEFAULT_BATCH_CONFIG.maxConcurrency}`)
      .max(
        DEFAULT_BATCH_CONFIG.maxConcurrency,
        `--concurrency must be between 1 and ${DEFAULT_BATCH_CONFIG.maxConcurrency}`,
      )
      .optional(),
    format: z.enum(['json', 'markdown', 'both']),
    out: z.string().min(1).optional(),
    stdout: z.boolean(),
    ai: z.boolean(),
    store: z.boolean(),
    profile: z.string().min(1).optional(),
    targetSalaryMin: z.coerce.number().finite().nonnegative().optional(),
    targetSalaryMax: z.coerce.number().finite().nonnegative().optional(),
    location: z.string().min(1).optional(),
    remotePreference: z.enum(['remote', 'hybrid', 'onsite', 'any']).optional(),
    provider: z.enum(['openai', 'openai-compatible']).optional(),
    model: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    destination: z.enum(['hosted', 'local', 'custom']).optional(),
    confirmTransmission: z.boolean().optional(),
    structuredOutputMode: z.enum(['json-schema', 'json-object']).optional(),
    providerTimeoutMs: z.coerce.number().finite().int().positive().optional(),
    maxInputChars: z.coerce.number().finite().int().positive().optional(),
    maxOutputTokens: z.coerce.number().finite().int().positive().optional(),
    maxTotalTokens: z.coerce.number().finite().int().positive().optional(),
    maxCostUsd: z.coerce.number().finite().nonnegative().optional(),
    inputCostPerMillionUsd: z.coerce.number().finite().nonnegative().optional(),
    outputCostPerMillionUsd: z.coerce.number().finite().nonnegative().optional(),
    redactEmployer: z.boolean().optional(),
    redactClearance: z.boolean().optional(),
    redactTerm: z.array(z.string().min(1)).optional(),
    webhook: z.string().url().max(2048).optional(),
    confirmWebhookTransmission: z.boolean().optional(),
    webhookTimeoutMs: z.coerce
      .number()
      .finite()
      .int()
      .min(1_000)
      .max(60_000)
      .default(DEFAULT_WEBHOOK_CONFIG.timeoutMs),
  })
  .strict()
  .superRefine((options, context) => {
    if (options.manifest !== undefined) {
      const batchConflicts = [
        { field: 'resume', label: '--resume' },
        { field: 'job', label: '--job' },
        { field: 'stdinResume', label: '--stdin-resume' },
        { field: 'stdinJob', label: '--stdin-job' },
      ] as const;
      for (const { field, label } of batchConflicts) {
        if (options[field] !== undefined) {
          context.addIssue({
            code: 'custom',
            message: `--manifest cannot be combined with ${label}`,
            path: [field],
          });
        }
      }
      if (options.profile !== undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Batch analysis does not support --profile',
          path: ['profile'],
        });
      }
      if (options.provider !== undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Batch analysis does not support AI providers',
          path: ['provider'],
        });
      }
      if (options.ai) {
        context.addIssue({
          code: 'custom',
          message: 'Batch analysis requires --no-ai',
          path: ['ai'],
        });
      }
      const providerSubOptionFields = [
        { field: 'model', label: '--model' },
        { field: 'baseUrl', label: '--base-url' },
        { field: 'destination', label: '--destination' },
        { field: 'confirmTransmission', label: '--confirm-transmission' },
        { field: 'structuredOutputMode', label: '--structured-output-mode' },
        { field: 'providerTimeoutMs', label: '--provider-timeout-ms' },
        { field: 'maxInputChars', label: '--max-input-chars' },
        { field: 'maxOutputTokens', label: '--max-output-tokens' },
        { field: 'maxTotalTokens', label: '--max-total-tokens' },
        { field: 'maxCostUsd', label: '--max-cost-usd' },
        { field: 'inputCostPerMillionUsd', label: '--input-cost-per-million-usd' },
        { field: 'outputCostPerMillionUsd', label: '--output-cost-per-million-usd' },
        { field: 'redactEmployer', label: '--redact-employer' },
        { field: 'redactClearance', label: '--redact-clearance' },
      ] as const;
      for (const { field, label } of providerSubOptionFields) {
        if (options[field] !== undefined) {
          context.addIssue({
            code: 'custom',
            message: `Batch analysis does not support ${label}`,
            path: [field],
          });
        }
      }
      if ((options.redactTerm?.length ?? 0) > 0) {
        context.addIssue({
          code: 'custom',
          message: 'Batch analysis does not support --redact-term',
          path: ['redactTerm'],
        });
      }
      if (!options.ai && options.webhook === undefined) return;
      if (options.webhook !== undefined) {
        try {
          const url = new URL(options.webhook);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            context.addIssue({
              code: 'custom',
              message: '--webhook must be an HTTP(S) URL',
              path: ['webhook'],
            });
          }
          if (url.username !== '' || url.password !== '') {
            context.addIssue({
              code: 'custom',
              message: '--webhook must not include credentials',
              path: ['webhook'],
            });
          }
        } catch {
          context.addIssue({
            code: 'custom',
            message: '--webhook must be a URL',
            path: ['webhook'],
          });
        }
        if (!isLocalWebhookUrl(options.webhook) && !options.confirmWebhookTransmission) {
          context.addIssue({
            code: 'custom',
            message: '--confirm-webhook-transmission is required for non-local webhook URLs',
            path: ['confirmWebhookTransmission'],
          });
        }
      }
      return;
    }
    if (
      (options.stdinResume !== undefined && options.resume !== undefined) ||
      (options.stdinResume !== undefined && options.stdinJob !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          options.stdinResume !== undefined && options.resume !== undefined
            ? '--stdin-resume cannot be combined with --resume'
            : '--stdin-resume cannot be combined with --stdin-job',
        path: ['stdinResume'],
      });
    }
    if (options.stdinJob !== undefined && options.job !== undefined) {
      context.addIssue({
        code: 'custom',
        message: '--stdin-job cannot be combined with --job',
        path: ['stdinJob'],
      });
    }
    if (options.resume === undefined && options.stdinResume === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Resume source required: --resume or --stdin-resume',
        path: ['resume'],
      });
    }
    if (options.job === undefined && options.stdinJob === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Job source required: --job or --stdin-job',
        path: ['job'],
      });
    }
    if (
      options.targetSalaryMin !== undefined &&
      options.targetSalaryMax !== undefined &&
      options.targetSalaryMin > options.targetSalaryMax
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Target salary minimum must not exceed the maximum',
        path: ['targetSalaryMin'],
      });
    }
    if (options.format === 'both' && options.stdout) {
      context.addIssue({
        code: 'custom',
        message: 'JSON and Markdown cannot be written together to stdout',
        path: ['stdout'],
      });
    }
    const providerFields = [
      options.provider,
      options.model,
      options.baseUrl,
      options.destination,
      options.confirmTransmission,
      options.structuredOutputMode,
      options.providerTimeoutMs,
      options.maxInputChars,
      options.maxOutputTokens,
      options.maxTotalTokens,
      options.maxCostUsd,
      options.inputCostPerMillionUsd,
      options.outputCostPerMillionUsd,
      options.redactEmployer,
      options.redactClearance,
      ...(options.redactTerm ?? []),
    ];
    if (!options.ai && providerFields.some((value) => value !== undefined && value !== false)) {
      context.addIssue({
        code: 'custom',
        message: '--no-ai conflicts with provider options',
        path: ['ai'],
      });
    }
    if ((options.provider === undefined) !== (options.model === undefined)) {
      context.addIssue({
        code: 'custom',
        message: '--provider and --model are required together',
        path: ['provider'],
      });
    }
    if (
      options.provider === undefined &&
      providerFields.slice(2).some((value) => value !== undefined && value !== false)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Provider-only options require --provider and --model',
        path: ['provider'],
      });
    }
    if (options.provider === 'openai') {
      if (
        options.baseUrl !== undefined ||
        (options.destination !== undefined && options.destination !== 'hosted')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'OpenAI uses its fixed hosted endpoint',
          path: ['baseUrl'],
        });
      }
      if (options.structuredOutputMode === 'json-object') {
        context.addIssue({
          code: 'custom',
          message: 'OpenAI requires json-schema structured output',
          path: ['structuredOutputMode'],
        });
      }
    }
    if (
      options.provider === 'openai-compatible' &&
      (options.baseUrl === undefined || options.destination === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'OpenAI-compatible providers require --base-url and --destination',
        path: ['baseUrl'],
      });
    }
    const ratesPresent =
      options.inputCostPerMillionUsd !== undefined && options.outputCostPerMillionUsd !== undefined;
    if (
      (options.inputCostPerMillionUsd === undefined) !==
        (options.outputCostPerMillionUsd === undefined) ||
      (options.maxCostUsd !== undefined && !ratesPresent)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Maximum cost requires both input and output rates',
        path: ['maxCostUsd'],
      });
    }
    const destination = options.provider === 'openai' ? 'hosted' : options.destination;
    if (options.provider !== undefined && destination !== 'local' && !options.confirmTransmission) {
      context.addIssue({
        code: 'custom',
        message: 'Hosted and custom transmission requires --confirm-transmission',
        path: ['confirmTransmission'],
      });
    }
    if (options.webhook !== undefined) {
      try {
        const url = new URL(options.webhook);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          context.addIssue({
            code: 'custom',
            message: '--webhook must be an HTTP(S) URL',
            path: ['webhook'],
          });
        }
        if (url.username !== '' || url.password !== '') {
          context.addIssue({
            code: 'custom',
            message: '--webhook must not include credentials',
            path: ['webhook'],
          });
        }
      } catch {
        context.addIssue({ code: 'custom', message: '--webhook must be a URL', path: ['webhook'] });
      }
      if (!isLocalWebhookUrl(options.webhook) && !options.confirmWebhookTransmission) {
        context.addIssue({
          code: 'custom',
          message: '--confirm-webhook-transmission is required for non-local webhook URLs',
          path: ['confirmWebhookTransmission'],
        });
      }
    }
  });

export type AnalyzeOptions = z.infer<typeof AnalyzeOptionsSchema>;

import { z } from 'zod';

export const AnalyzeOptionsSchema = z
  .object({
    resume: z.string().min(1),
    job: z.string().min(1),
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
  })
  .strict()
  .superRefine((options, context) => {
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
  });

export type AnalyzeOptions = z.infer<typeof AnalyzeOptionsSchema>;

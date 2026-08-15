import { z } from 'zod';

import { AnalysisResultSchema } from './schemas.js';

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank',
});

const idSchema = nonBlankStringSchema;

export const BatchManifestPairSchema = z
  .object({
    resume: nonBlankStringSchema.max(4096),
    job: nonBlankStringSchema.max(4096),
  })
  .strict();

export const BatchManifestSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    pairs: z.array(BatchManifestPairSchema).min(1, 'Batch manifest must contain at least one pair'),
  })
  .strict();

export const BatchConfigSchema = z
  .object({
    maxConcurrency: z.number().int().min(1),
    defaultConcurrency: z.number().int().min(1),
    maxPairs: z.number().int().min(1),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.defaultConcurrency > config.maxConcurrency) {
      context.addIssue({
        code: 'custom',
        message: 'Default concurrency must not exceed the maximum',
        path: ['defaultConcurrency'],
      });
    }
  });

export const DEFAULT_BATCH_CONFIG: Readonly<BatchConfig> = Object.freeze(
  BatchConfigSchema.parse({
    maxConcurrency: 8,
    defaultConcurrency: 4,
    maxPairs: 200,
  }),
);

export const BatchPairResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('completed'),
      resumeDocumentId: idSchema,
      jobId: idSchema,
      analysis: AnalysisResultSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      code: z.number().int().min(1),
      error: nonBlankStringSchema,
    })
    .strict(),
]);

export const BatchEnvelopeSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    pairs: z.array(BatchPairResultSchema),
  })
  .strict();

export const AutomationHttpMethodSchema = z.enum(['GET', 'POST']);

export const AutomationApiEndpointSchema = z
  .object({
    method: AutomationHttpMethodSchema,
    path: z.string().regex(/^\/api\/automation(?:\/[-a-z]+)*$/u),
    description: nonBlankStringSchema.max(255),
  })
  .strict();

export const AutomationApiManifestSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    mode: z.literal('local'),
    endpoints: z.array(AutomationApiEndpointSchema).min(1),
  })
  .strict();

export const WebhookConfigSchema = z
  .object({
    timeoutMs: z.number().int().min(1_000).max(60_000),
  })
  .strict();

export const DEFAULT_WEBHOOK_CONFIG: Readonly<WebhookConfig> = Object.freeze(
  WebhookConfigSchema.parse({ timeoutMs: 10_000 }),
);

export const WebhookDeliveryResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      schemaVersion: z.literal('1.0'),
      url: z.string().url().max(2048),
      status: z.literal('delivered'),
      statusCode: z.number().int().min(200).max(299),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal('1.0'),
      url: z.string().url().max(2048),
      status: z.literal('failed'),
      statusCode: z.number().int().min(100).max(599).optional(),
      error: nonBlankStringSchema.max(255),
    })
    .strict(),
]);

export type BatchManifestPair = z.infer<typeof BatchManifestPairSchema>;
export type BatchManifest = z.infer<typeof BatchManifestSchema>;
export type BatchConfig = z.infer<typeof BatchConfigSchema>;
export type BatchPairResult = z.infer<typeof BatchPairResultSchema>;
export type BatchEnvelope = z.infer<typeof BatchEnvelopeSchema>;
export type AutomationHttpMethod = z.infer<typeof AutomationHttpMethodSchema>;
export type AutomationApiEndpoint = z.infer<typeof AutomationApiEndpointSchema>;
export type AutomationApiManifest = z.infer<typeof AutomationApiManifestSchema>;
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;
export type WebhookDeliveryResult = z.infer<typeof WebhookDeliveryResultSchema>;

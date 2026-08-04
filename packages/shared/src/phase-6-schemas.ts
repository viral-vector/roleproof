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

export type BatchManifestPair = z.infer<typeof BatchManifestPairSchema>;
export type BatchManifest = z.infer<typeof BatchManifestSchema>;
export type BatchConfig = z.infer<typeof BatchConfigSchema>;
export type BatchPairResult = z.infer<typeof BatchPairResultSchema>;
export type BatchEnvelope = z.infer<typeof BatchEnvelopeSchema>;

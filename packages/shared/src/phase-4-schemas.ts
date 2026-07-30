import { z } from 'zod';

import { AnalysisEnvelopeSchema } from './phase-1-schemas.js';

const MAX_LOCAL_API_TEXT_CHARS = 1_000_000;

const localApiTextSchema = z
  .string()
  .min(1)
  .max(MAX_LOCAL_API_TEXT_CHARS)
  .refine((value) => value.trim().length > 0, { message: 'Text must not be blank' });

export const LocalAnalyzeRequestSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    resumeText: localApiTextSchema,
    jobText: localApiTextSchema,
    mode: z.literal('deterministic').default('deterministic'),
  })
  .strict();

export const LocalAnalyzeResponseSchema = AnalysisEnvelopeSchema;

export type LocalAnalyzeRequest = z.infer<typeof LocalAnalyzeRequestSchema>;
export type LocalAnalyzeResponse = z.infer<typeof LocalAnalyzeResponseSchema>;

import { z } from 'zod';

import { JobRetrievalMetadataSchema as BaseJobRetrievalMetadataSchema } from './schemas.js';

const urlCandidateSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => /^https?:\/\//iu.test(value), {
    message: 'Job URL must be an http or https URL',
  })
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Job URL must be valid');

export const JobUrlSchema = urlCandidateSchema;
export const LocalJobUrlSchema = JobUrlSchema;

export const JobUrlConfigSchema = z
  .object({
    maxFetchBytes: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    maxRedirects: z.number().int().nonnegative(),
  })
  .strict();

export const StoredJobSourceSchema = BaseJobRetrievalMetadataSchema.extend({
  jobId: z.string().min(1).max(255),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict();

export const LocalJobSourceParseSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    text: z
      .string()
      .min(1)
      .max(1_000_000)
      .refine((value) => value.trim().length > 0, { message: 'Text must not be blank' }),
    source: BaseJobRetrievalMetadataSchema,
  })
  .strict();

export type LocalJobUrl = z.infer<typeof LocalJobUrlSchema>;
export type JobUrl = z.infer<typeof JobUrlSchema>;
export type JobUrlConfig = z.infer<typeof JobUrlConfigSchema>;
export type StoredJobSource = z.infer<typeof StoredJobSourceSchema>;
export type LocalJobSourceParse = z.infer<typeof LocalJobSourceParseSchema>;

import { z } from 'zod';

import { AnalysisEnvelopeSchema, ParseWarningSchema } from './phase-1-schemas.js';

const MAX_LOCAL_API_TEXT_CHARS = 1_000_000;
export const LOCAL_RESUME_TEXT_MAX_BYTES = 1_000_000;
export const LOCAL_RESUME_PDF_MAX_BYTES = 10_000_000;
export const LOCAL_RESUME_DOCX_MAX_BYTES = 10_000_000;

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

export const LocalResumeUploadMetadataSchema = z
  .object({
    fileName: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => value.trim() === value && !/[\\/]/u.test(value), {
        message: 'File name must be a safe base name',
      }),
    format: z.enum(['plaintext', 'pdf', 'docx']),
    byteLength: z.number().int().positive().max(LOCAL_RESUME_PDF_MAX_BYTES),
  })
  .strict()
  .superRefine((metadata, context) => {
    const expectedExtension =
      metadata.format === 'pdf' ? '.pdf' : metadata.format === 'docx' ? '.docx' : '.txt';
    if (!metadata.fileName.toLocaleLowerCase('en-US').endsWith(expectedExtension)) {
      context.addIssue({
        code: 'custom',
        message: `File name must end with ${expectedExtension}`,
        path: ['fileName'],
      });
    }
    if (metadata.format === 'plaintext' && metadata.byteLength > LOCAL_RESUME_TEXT_MAX_BYTES) {
      context.addIssue({
        code: 'custom',
        message: `Plaintext resume exceeds the ${LOCAL_RESUME_TEXT_MAX_BYTES}-byte limit`,
        path: ['byteLength'],
      });
    }
    if (metadata.format === 'docx' && metadata.byteLength > LOCAL_RESUME_DOCX_MAX_BYTES) {
      context.addIssue({
        code: 'custom',
        message: `DOCX resume exceeds the ${LOCAL_RESUME_DOCX_MAX_BYTES}-byte limit`,
        path: ['byteLength'],
      });
    }
  });

export const LocalResumeParseResponseSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    text: localApiTextSchema,
    format: z.enum(['plaintext', 'pdf', 'docx']),
    warnings: z.array(ParseWarningSchema),
  })
  .strict();

export const LocalResumeParseErrorCodeSchema = z.enum([
  'binary-content',
  'docx-error',
  'empty-document',
  'pdf-error',
  'pdf-page-limit',
  'pdf-timeout',
  'size-limit',
]);

export const LocalResumeParseErrorSchema = z
  .object({
    error: z.string(),
    code: LocalResumeParseErrorCodeSchema.optional(),
  })
  .strict();

export type LocalAnalyzeRequest = z.infer<typeof LocalAnalyzeRequestSchema>;
export type LocalAnalyzeResponse = z.infer<typeof LocalAnalyzeResponseSchema>;
export type LocalResumeUploadMetadata = z.infer<typeof LocalResumeUploadMetadataSchema>;
export type LocalResumeParseResponse = z.infer<typeof LocalResumeParseResponseSchema>;
export type LocalResumeParseError = z.infer<typeof LocalResumeParseErrorSchema>;
export type LocalResumeParseErrorCode = z.infer<typeof LocalResumeParseErrorCodeSchema>;

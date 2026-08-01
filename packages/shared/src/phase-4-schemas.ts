import { z } from 'zod';

import { AnalysisEnvelopeSchema, ParseWarningSchema } from './phase-1-schemas.js';
import { AnalysisHistoryItemSchema } from './phase-2-schemas.js';

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

export const LocalHistoryItemSchema = AnalysisHistoryItemSchema;

export const LocalHistoryListResponseSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    history: z.array(LocalHistoryItemSchema),
  })
  .strict();

export const LocalHistoryDetailResponseSchema = AnalysisEnvelopeSchema;

export const LocalHistoryQuerySchema = z
  .object({
    query: z.string().max(500).optional(),
  })
  .strict();

const LocalSettingsBaseSchema = z
  .object({
    provider: z.enum(['openai', 'openai-compatible']).nullable().optional(),
    model: z.string().trim().min(1).max(255).nullable().optional(),
    destination: z.enum(['hosted', 'local', 'custom']).nullable().optional(),
    baseUrl: z.string().trim().min(1).max(2048).nullable().optional(),
    redactEmployer: z.boolean().optional(),
    redactClearance: z.boolean().optional(),
    redactionTerms: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
    defaultExportFormat: z.enum(['json', 'markdown']).nullable().optional(),
    maxTotalTokens: z.number().int().min(1).max(10_000_000).nullable().optional(),
    maxCostUsd: z.number().finite().min(0).max(10_000).nullable().optional(),
    providerTimeoutMs: z.number().int().min(1_000).max(3_600_000).nullable().optional(),
  })
  .strict();

export const LocalSettingsPatchSchema = LocalSettingsBaseSchema;

export const LocalSettingsSchema = LocalSettingsBaseSchema.superRefine((settings, context) => {
  const provider = settings.provider;
  const model = settings.model;
  if (provider !== undefined && provider !== null && (model === undefined || model === null)) {
    context.addIssue({
      code: 'custom',
      message: 'A model is required when a provider is configured',
      path: ['model'],
    });
  }
  if (
    provider === 'openai-compatible' &&
    (settings.baseUrl === undefined || settings.baseUrl === null)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'An API base URL is required for openai-compatible providers',
      path: ['baseUrl'],
    });
  }
});

export const LocalSettingsResponseSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    settings: LocalSettingsSchema,
    databasePath: z.string().min(1),
  })
  .strict();

export type LocalAnalyzeRequest = z.infer<typeof LocalAnalyzeRequestSchema>;
export type LocalAnalyzeResponse = z.infer<typeof LocalAnalyzeResponseSchema>;
export type LocalResumeUploadMetadata = z.infer<typeof LocalResumeUploadMetadataSchema>;
export type LocalResumeParseResponse = z.infer<typeof LocalResumeParseResponseSchema>;
export type LocalResumeParseError = z.infer<typeof LocalResumeParseErrorSchema>;
export type LocalResumeParseErrorCode = z.infer<typeof LocalResumeParseErrorCodeSchema>;
export type LocalHistoryItem = z.infer<typeof LocalHistoryItemSchema>;
export type LocalHistoryListResponse = z.infer<typeof LocalHistoryListResponseSchema>;
export type LocalHistoryDetailResponse = z.infer<typeof LocalHistoryDetailResponseSchema>;
export type LocalHistoryQuery = z.infer<typeof LocalHistoryQuerySchema>;
export type LocalSettingsPatch = z.infer<typeof LocalSettingsPatchSchema>;
export type LocalSettings = z.infer<typeof LocalSettingsSchema>;
export type LocalSettingsResponse = z.infer<typeof LocalSettingsResponseSchema>;

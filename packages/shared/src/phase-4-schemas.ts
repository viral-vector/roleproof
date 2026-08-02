import { z } from 'zod';

import { AnalysisEnvelopeSchema, ParseWarningSchema } from './phase-1-schemas.js';
import { AnalysisHistoryItemSchema } from './phase-2-schemas.js';
import {
  EnhancedAnalysisEnvelopeSchema,
  ProviderDestinationSchema,
  ProviderIdSchema,
} from './phase-3-schemas.js';

const MAX_LOCAL_API_TEXT_CHARS = 1_000_000;
export const LOCAL_RESUME_TEXT_MAX_BYTES = 1_000_000;
export const LOCAL_RESUME_PDF_MAX_BYTES = 10_000_000;
export const LOCAL_RESUME_DOCX_MAX_BYTES = 10_000_000;

const localApiTextSchema = z
  .string()
  .min(1)
  .max(MAX_LOCAL_API_TEXT_CHARS)
  .refine((value) => value.trim().length > 0, { message: 'Text must not be blank' });

const LocalDeterministicAnalyzeRequestSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    resumeText: localApiTextSchema,
    jobText: localApiTextSchema,
    mode: z.literal('deterministic').default('deterministic'),
  })
  .strict();

const LocalAIAnalyzeRequestSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    resumeText: localApiTextSchema,
    jobText: localApiTextSchema,
    mode: z.literal('ai-enhanced'),
    confirmProviderTransmission: z.literal(true),
  })
  .strict();

export const LocalAnalyzeRequestSchema = z.union([
  LocalDeterministicAnalyzeRequestSchema,
  LocalAIAnalyzeRequestSchema,
]);

export const LocalAnalyzeResponseSchema = z.union([
  AnalysisEnvelopeSchema,
  EnhancedAnalysisEnvelopeSchema,
]);

export const LocalAnalyzeProgressStageSchema = z.enum([
  'parsing-resume',
  'parsing-job',
  'baseline-analysis',
  'provider-requirements',
  'provider-evidence',
  'provider-suggestions',
  'complete',
]);

export const LocalAnalyzeProgressEventSchema = z
  .object({
    kind: z.literal('progress'),
    stage: LocalAnalyzeProgressStageSchema,
    completed: z.number().int().min(0),
    total: z.number().int().min(1),
    message: z.string().min(1).max(255),
  })
  .strict();

export const LocalAnalyzeResultEventSchema = z
  .object({
    kind: z.literal('result'),
    response: LocalAnalyzeResponseSchema,
  })
  .strict();

export const LocalAnalyzeErrorEventSchema = z
  .object({
    kind: z.literal('error'),
    error: z.string().min(1).max(255),
  })
  .strict();

export const LocalAnalyzeStreamEventSchema = z.union([
  LocalAnalyzeProgressEventSchema,
  LocalAnalyzeResultEventSchema,
  LocalAnalyzeErrorEventSchema,
]);

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
    maxTotalTokens: z.number().int().min(1).max(1_000_000).nullable().optional(),
    maxCostUsd: z.number().finite().min(0).max(1_000).nullable().optional(),
    inputMicroUsdPerMillionTokens: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
    outputMicroUsdPerMillionTokens: z
      .number()
      .int()
      .min(0)
      .max(1_000_000_000)
      .nullable()
      .optional(),
    providerTimeoutMs: z.number().int().min(1_000).max(300_000).nullable().optional(),
    structuredOutputMode: z.enum(['json-schema', 'json-object']).nullable().optional(),
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
  if (
    settings.maxCostUsd !== undefined &&
    settings.maxCostUsd !== null &&
    (settings.inputMicroUsdPerMillionTokens === undefined ||
      settings.inputMicroUsdPerMillionTokens === null ||
      settings.outputMicroUsdPerMillionTokens === undefined ||
      settings.outputMicroUsdPerMillionTokens === null)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'A maximum cost requires input and output token rates',
      path: ['maxCostUsd'],
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

export const LocalProviderCredentialProviderSchema = z.enum(['openai', 'openai-compatible']);

export const LocalProviderCredentialStatusSchema = z
  .object({
    provider: LocalProviderCredentialProviderSchema,
    configured: z.boolean(),
    source: z.enum(['key-store', 'environment', 'none']),
  })
  .strict();

export const LocalProviderCredentialStatusResponseSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    credentials: z.array(LocalProviderCredentialStatusSchema).length(2),
  })
  .strict();

export const LocalProviderCredentialSaveRequestSchema = z
  .object({
    provider: LocalProviderCredentialProviderSchema,
    apiKey: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => value.trim().length > 0, { message: 'API key must not be blank' }),
  })
  .strict();

export const LocalProviderCredentialDeleteResponseSchema = z
  .object({ removed: z.boolean() })
  .strict();

export const LocalProviderModelsQuerySchema = z
  .object({
    provider: ProviderIdSchema,
    destination: ProviderDestinationSchema.nullable().optional(),
    baseUrl: z.string().trim().min(1).max(2048).nullable().optional(),
    model: z.string().trim().min(1).max(255).nullable().optional(),
  })
  .strict();

export const LocalProviderModelSchema = z
  .object({
    id: z.string().trim().min(1).max(255),
    structuredOutputSupported: z.boolean().nullable().optional(),
  })
  .strict();

export const LocalProviderModelsResponseSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    models: z.array(LocalProviderModelSchema).max(1_000),
  })
  .strict();

export type LocalAnalyzeRequest = z.infer<typeof LocalAnalyzeRequestSchema>;
export type LocalAnalyzeResponse = z.infer<typeof LocalAnalyzeResponseSchema>;
export type LocalAnalyzeProgressEvent = z.infer<typeof LocalAnalyzeProgressEventSchema>;
export type LocalAnalyzeResultEvent = z.infer<typeof LocalAnalyzeResultEventSchema>;
export type LocalAnalyzeErrorEvent = z.infer<typeof LocalAnalyzeErrorEventSchema>;
export type LocalAnalyzeStreamEvent = z.infer<typeof LocalAnalyzeStreamEventSchema>;
export type LocalAnalyzeProgressStage = z.infer<typeof LocalAnalyzeProgressStageSchema>;
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
export type LocalProviderCredentialProvider = z.infer<typeof LocalProviderCredentialProviderSchema>;
export type LocalProviderCredentialStatus = z.infer<typeof LocalProviderCredentialStatusSchema>;
export type LocalProviderCredentialStatusResponse = z.infer<
  typeof LocalProviderCredentialStatusResponseSchema
>;
export type LocalProviderCredentialSaveRequest = z.infer<
  typeof LocalProviderCredentialSaveRequestSchema
>;
export type LocalProviderCredentialDeleteResponse = z.infer<
  typeof LocalProviderCredentialDeleteResponseSchema
>;
export type LocalProviderModelsQuery = z.infer<typeof LocalProviderModelsQuerySchema>;
export type LocalProviderModel = z.infer<typeof LocalProviderModelSchema>;
export type LocalProviderModelsResponse = z.infer<typeof LocalProviderModelsResponseSchema>;

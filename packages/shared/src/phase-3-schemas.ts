import { z } from 'zod';

import {
  AnalysisResultSchema,
  JobRequirementImportanceSchema,
  MatchClassificationSchema,
} from './schemas.js';

const MAX_ID_LENGTH = 128;
const MAX_SHORT_TEXT_LENGTH = 512;
const MAX_SUMMARY_LENGTH = 20_000;
const MAX_EXPLANATION_LENGTH = 4_000;
export const MAX_PROVIDER_INPUT_ITEMS = 100;
const MAX_INPUT_CHARS = 1_000_000;
const MAX_TOKENS = 1_000_000;
const MAX_COST_MICRO_USD = 1_000_000_000;

const boundedNonBlankString = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, { message: 'Value must not be blank' });

const idSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, 'ID contains unsupported characters');
const shortTextSchema = boundedNonBlankString(MAX_SHORT_TEXT_LENGTH);
const summarySchema = boundedNonBlankString(MAX_SUMMARY_LENGTH);
const explanationSchema = boundedNonBlankString(MAX_EXPLANATION_LENGTH);
const boundedIntegerSchema = (maximum: number) => z.number().int().finite().min(0).max(maximum);
const idArraySchema = z.array(idSchema).max(MAX_PROVIDER_INPUT_ITEMS);
const isLoopback = (hostname: string): boolean => {
  const normalized = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return true;
  const octets = normalized.split('.');
  return (
    octets.length === 4 &&
    octets.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255) &&
    octets[0] === '127'
  );
};

export const ProviderIdSchema = z.enum(['openai', 'openai-compatible']);
export const ProviderDestinationSchema = z.enum(['hosted', 'local', 'custom']);
export const StructuredOutputModeSchema = z.enum(['json-schema', 'json-object']);
export const ProviderErrorCodeSchema = z.enum([
  'auth',
  'rate-limit',
  'timeout',
  'unavailable',
  'refusal',
  'incomplete',
  'invalid-output',
  'budget-exceeded',
  'configuration',
]);
export const ProviderOperationSchema = z.enum([
  'analyze-requirements',
  'map-evidence',
  'suggest-application-changes',
  'health-check',
]);

export const RedactionCategorySchema = z.enum([
  'email',
  'phone',
  'address',
  'confidential-employer-name',
  'clearance-detail',
  'user-selected-term',
]);

export const RedactionConfigSchema = z
  .object({
    email: z.boolean(),
    phone: z.boolean(),
    address: z.boolean(),
    confidentialEmployerNames: z.boolean(),
    clearanceDetails: z.boolean(),
    userSelectedTerms: z.array(shortTextSchema).max(100),
  })
  .strict();

export const RedactionSummarySchema = z
  .object({
    categories: z.array(RedactionCategorySchema).max(6),
    replacementCount: boundedIntegerSchema(100_000),
    inputChars: boundedIntegerSchema(MAX_INPUT_CHARS),
    outputChars: boundedIntegerSchema(MAX_INPUT_CHARS),
  })
  .strict();

export const ProviderRatesSchema = z
  .object({
    inputMicroUsdPerMillionTokens: boundedIntegerSchema(MAX_COST_MICRO_USD),
    outputMicroUsdPerMillionTokens: boundedIntegerSchema(MAX_COST_MICRO_USD),
  })
  .strict();

export const ProviderConfigSchema = z
  .object({
    provider: ProviderIdSchema,
    model: shortTextSchema,
    baseUrl: z.url().max(2_048).nullable(),
    destination: ProviderDestinationSchema,
    requestTimeoutMs: z.number().int().finite().min(1).max(300_000),
    maxInputChars: z.number().int().finite().min(1).max(MAX_INPUT_CHARS),
    maxOutputTokens: z.number().int().finite().min(1).max(MAX_TOKENS),
    maxTotalTokens: z.number().int().finite().min(1).max(MAX_TOKENS),
    maxCostMicroUsd: boundedIntegerSchema(MAX_COST_MICRO_USD).nullable(),
    rates: ProviderRatesSchema.nullable(),
    structuredOutputMode: StructuredOutputModeSchema,
    redaction: RedactionConfigSchema,
  })
  .strict()
  .superRefine((config, context) => {
    if (config.maxOutputTokens > config.maxTotalTokens) {
      context.addIssue({
        code: 'custom',
        message: 'Maximum output tokens cannot exceed maximum total tokens',
        path: ['maxOutputTokens'],
      });
    }
    if (config.maxCostMicroUsd !== null && config.rates === null) {
      context.addIssue({
        code: 'custom',
        message: 'A maximum cost requires provider rates',
        path: ['rates'],
      });
    }

    if (config.destination !== 'hosted' && config.baseUrl === null) {
      context.addIssue({
        code: 'custom',
        message: 'Local and custom providers require a base URL',
        path: ['baseUrl'],
      });
    }
    if (
      config.provider === 'openai' &&
      (config.destination !== 'hosted' ||
        config.baseUrl !== null ||
        config.structuredOutputMode !== 'json-schema')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'OpenAI requires its fixed hosted JSON-schema endpoint',
        path: ['provider'],
      });
    }
    if (config.provider === 'openai-compatible' && config.baseUrl !== null) {
      const endpoint = new URL(config.baseUrl);
      if (
        endpoint.username !== '' ||
        endpoint.password !== '' ||
        endpoint.search !== '' ||
        endpoint.hash !== '' ||
        !['http:', 'https:'].includes(endpoint.protocol) ||
        (config.destination === 'local' && !isLoopback(endpoint.hostname)) ||
        (config.destination !== 'local' && endpoint.protocol !== 'https:')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Provider endpoint is not safe for the selected destination',
          path: ['baseUrl'],
        });
      }
    }
    if (config.provider === 'openai-compatible' && config.baseUrl === null) {
      context.addIssue({
        code: 'custom',
        message: 'OpenAI-compatible providers require a base URL',
        path: ['baseUrl'],
      });
    }
  });

export const TransmissionDataCategorySchema = z.enum([
  'job-summary',
  'resume-summary',
  'requirement-text',
  'evidence-summary',
  'baseline-classification',
]);

const endpointOriginSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return value === url.origin || value === `${url.origin}/`;
  }, 'Endpoint must contain only an origin');

export const TransmissionManifestSchema = z
  .object({
    provider: ProviderIdSchema,
    model: shortTextSchema,
    destination: ProviderDestinationSchema,
    endpointOrigin: endpointOriginSchema,
    dataCategories: z.array(TransmissionDataCategorySchema).max(5),
    redactionApplied: z.boolean(),
    redactionSummary: RedactionSummarySchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    if (!manifest.redactionApplied && manifest.redactionSummary.replacementCount !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'A non-redacted transmission cannot report replacements',
        path: ['redactionSummary', 'replacementCount'],
      });
    }
  });

const nullableUsageValueSchema = boundedIntegerSchema(MAX_TOKENS).nullable();

export const ProviderUsageSchema = z
  .object({
    inputTokens: nullableUsageValueSchema,
    outputTokens: nullableUsageValueSchema,
    totalTokens: nullableUsageValueSchema,
    costMicroUsd: boundedIntegerSchema(MAX_COST_MICRO_USD).nullable(),
  })
  .strict()
  .superRefine((usage, context) => {
    if (
      usage.inputTokens !== null &&
      usage.outputTokens !== null &&
      usage.totalTokens !== null &&
      usage.inputTokens + usage.outputTokens !== usage.totalTokens
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Total tokens must equal input plus output tokens',
        path: ['totalTokens'],
      });
    }
  });

export const ProviderExecutionMetadataSchema = z
  .object({
    operation: ProviderOperationSchema,
    provider: ProviderIdSchema,
    model: shortTextSchema,
    destination: ProviderDestinationSchema,
    manifest: TransmissionManifestSchema,
    usage: ProviderUsageSchema,
    requestId: idSchema.nullable().optional(),
    errorCode: ProviderErrorCodeSchema.nullable(),
  })
  .strict();

export const ProviderHealthSchema = z
  .object({
    provider: ProviderIdSchema,
    destination: ProviderDestinationSchema,
    status: z.enum(['healthy', 'degraded', 'unavailable']),
    latencyMs: boundedIntegerSchema(300_000).nullable(),
    errorCode: ProviderErrorCodeSchema.nullable(),
    message: boundedNonBlankString(1_000).nullable(),
    modelAvailable: z.boolean().nullable().optional(),
    structuredOutputSupported: z.boolean().nullable().optional(),
  })
  .strict()
  .superRefine((health, context) => {
    if (health.status === 'healthy' && health.errorCode !== null) {
      context.addIssue({
        code: 'custom',
        message: 'A healthy provider cannot have an error code',
        path: ['errorCode'],
      });
    }
  });

export const ProviderSummarySchema = z
  .object({
    provider: ProviderIdSchema,
    model: shortTextSchema,
    destination: ProviderDestinationSchema,
    configured: z.boolean(),
  })
  .strict();

const BaselineRequirementSchema = z
  .object({
    requirementId: idSchema,
    text: summarySchema,
    importance: JobRequirementImportanceSchema,
    baselineClassification: MatchClassificationSchema,
    evidenceIds: idArraySchema,
  })
  .strict();

const ProviderRequirementResultSchema = z
  .object({
    requirementId: idSchema,
    baselineClassification: MatchClassificationSchema,
    classification: MatchClassificationSchema,
    evidenceIds: idArraySchema,
    explanation: explanationSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.classification === 'direct' && result.baselineClassification !== 'direct') {
      context.addIssue({
        code: 'custom',
        message: 'Provider output cannot upgrade a baseline classification to direct',
        path: ['classification'],
      });
    }
    if (
      ['direct', 'strongly-related', 'partially-related'].includes(result.classification) &&
      result.evidenceIds.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A supported classification must cite evidence',
        path: ['evidenceIds'],
      });
    }
  });

const RedactedEvidenceSchema = z
  .object({ evidenceId: idSchema, redactedSummary: summarySchema })
  .strict();

export const RequirementAnalysisInputSchema = z
  .object({
    baselineAnalysisId: idSchema,
    requirements: z.array(BaselineRequirementSchema).max(MAX_PROVIDER_INPUT_ITEMS),
    redactedJobSummary: summarySchema,
  })
  .strict();

export const RequirementAnalysisOutputSchema = z
  .object({
    requirements: z.array(ProviderRequirementResultSchema).max(MAX_PROVIDER_INPUT_ITEMS),
  })
  .strict();

export const EvidenceMappingInputSchema = z
  .object({
    baselineAnalysisId: idSchema,
    requirements: z.array(BaselineRequirementSchema).max(MAX_PROVIDER_INPUT_ITEMS),
    evidence: z.array(RedactedEvidenceSchema).max(MAX_PROVIDER_INPUT_ITEMS),
  })
  .strict();

export const EvidenceMappingOutputSchema = z
  .object({ mappings: z.array(ProviderRequirementResultSchema).max(MAX_PROVIDER_INPUT_ITEMS) })
  .strict();

const ApplicationSuggestionSchema = z
  .object({
    text: summarySchema,
    classification: MatchClassificationSchema,
    evidenceIds: idArraySchema,
    explanation: explanationSchema,
  })
  .strict();

const SupportedApplicationSuggestionSchema = ApplicationSuggestionSchema.superRefine(
  (suggestion, context) => {
    if (suggestion.evidenceIds.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'An application suggestion must cite evidence',
        path: ['evidenceIds'],
      });
    }
  },
);

const SuggestedAdditionSchema = ApplicationSuggestionSchema.superRefine((suggestion, context) => {
  if (suggestion.classification !== 'requires-user-confirmation') {
    context.addIssue({
      code: 'custom',
      message: 'AI-authored additions require user confirmation',
      path: ['classification'],
    });
  }
});

export const InterviewTopicSchema = z
  .object({ topic: summarySchema, evidenceIds: idArraySchema.min(1), rationale: explanationSchema })
  .strict();

export const ApplicationSuggestionInputSchema = z
  .object({
    baselineAnalysisId: idSchema,
    requirements: z.array(BaselineRequirementSchema).max(MAX_PROVIDER_INPUT_ITEMS),
    evidence: z.array(RedactedEvidenceSchema).max(MAX_PROVIDER_INPUT_ITEMS),
    redactedResumeSummary: summarySchema,
    redactedJobSummary: summarySchema,
  })
  .strict();

export const ApplicationSuggestionOutputSchema = z
  .object({
    suggestedEmphasis: z.array(SupportedApplicationSuggestionSchema).max(MAX_PROVIDER_INPUT_ITEMS),
    suggestedAdditions: z.array(SuggestedAdditionSchema).max(MAX_PROVIDER_INPUT_ITEMS),
    interviewTopics: z.array(InterviewTopicSchema).max(MAX_PROVIDER_INPUT_ITEMS),
    coverLetterAngles: z
      .array(z.object({ text: summarySchema, evidenceIds: idArraySchema.min(1) }).strict())
      .max(MAX_PROVIDER_INPUT_ITEMS),
  })
  .strict();

export const AIEnhancementSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    baselineAnalysisId: idSchema,
    requirementAnalysis: RequirementAnalysisOutputSchema,
    evidenceMapping: EvidenceMappingOutputSchema,
    applicationSuggestions: ApplicationSuggestionOutputSchema,
    providerExecutions: z.array(ProviderExecutionMetadataSchema).min(1).max(4),
  })
  .strict()
  .superRefine((enhancement, context) => {
    if (
      enhancement.providerExecutions.some(
        (execution) =>
          execution.usage.inputTokens === null ||
          execution.usage.outputTokens === null ||
          execution.usage.totalTokens === null,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Successful enhancement executions require complete token usage',
        path: ['providerExecutions'],
      });
    }
  });

export const EnhancedAnalysisEnvelopeSchema = z
  .object({
    schemaVersion: z.literal('2.0'),
    analysis: AnalysisResultSchema,
    aiEnhancement: AIEnhancementSchema,
  })
  .strict()
  .superRefine((envelope, context) => {
    if (envelope.analysis.id !== envelope.aiEnhancement.baselineAnalysisId) {
      context.addIssue({
        code: 'custom',
        message: 'AI enhancement must reference the envelope analysis',
        path: ['aiEnhancement', 'baselineAnalysisId'],
      });
    }
  });

const storedTimestampSchema = z.iso.datetime({ offset: true });
const nullableStoredTokenSchema = boundedIntegerSchema(MAX_TOKENS).nullable();

export const StoredProviderCallSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    id: idSchema,
    baselineAnalysisId: idSchema.nullable(),
    provider: shortTextSchema,
    model: shortTextSchema.nullable(),
    operation: ProviderOperationSchema,
    destination: ProviderDestinationSchema,
    endpointOrigin: endpointOriginSchema.nullable(),
    status: z.enum(['succeeded', 'failed']),
    errorCode: ProviderErrorCodeSchema.nullable(),
    redactionApplied: z.boolean(),
    redactionCategories: z.array(RedactionCategorySchema).max(6),
    inputTokens: nullableStoredTokenSchema,
    outputTokens: nullableStoredTokenSchema,
    totalTokens: nullableStoredTokenSchema,
    costMicroUsd: boundedIntegerSchema(MAX_COST_MICRO_USD).nullable(),
    requestId: idSchema.nullable(),
    startedAt: storedTimestampSchema,
    completedAt: storedTimestampSchema,
    durationMs: boundedIntegerSchema(900_000),
    createdAt: storedTimestampSchema,
  })
  .strict()
  .superRefine((call, context) => {
    if (call.status === 'succeeded' && call.errorCode !== null) {
      context.addIssue({
        code: 'custom',
        message: 'A successful call cannot have an error code',
        path: ['errorCode'],
      });
    }
    if (
      call.inputTokens !== null &&
      call.outputTokens !== null &&
      call.totalTokens !== null &&
      call.inputTokens + call.outputTokens !== call.totalTokens
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Total tokens must equal input plus output tokens',
        path: ['totalTokens'],
      });
    }
    if (new Date(call.completedAt).getTime() < new Date(call.startedAt).getTime()) {
      context.addIssue({
        code: 'custom',
        message: 'Completion cannot precede start',
        path: ['completedAt'],
      });
    }
  });

export const StoredAIEnhancementSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    baselineAnalysisId: idSchema,
    configFingerprint: idSchema,
    enhancement: AIEnhancementSchema,
    createdAt: storedTimestampSchema,
  })
  .strict()
  .superRefine((stored, context) => {
    if (stored.baselineAnalysisId !== stored.enhancement.baselineAnalysisId) {
      context.addIssue({
        code: 'custom',
        message: 'Stored enhancement must reference the envelope baseline',
        path: ['enhancement', 'baselineAnalysisId'],
      });
    }
  });

export const ProviderCallFailureInputSchema = z
  .object({
    baselineAnalysisId: idSchema,
    provider: shortTextSchema,
    model: shortTextSchema,
    operation: ProviderOperationSchema,
    destination: ProviderDestinationSchema,
    endpointOrigin: endpointOriginSchema.nullable(),
    errorCode: ProviderErrorCodeSchema,
    manifest: TransmissionManifestSchema.nullable().optional(),
    completedExecutions: z.array(ProviderExecutionMetadataSchema).max(3).optional(),
    failedExecution: ProviderExecutionMetadataSchema.optional(),
    requestId: idSchema.nullable(),
    startedAt: storedTimestampSchema,
    completedAt: storedTimestampSchema,
    durationMs: boundedIntegerSchema(900_000),
  })
  .strict()
  .superRefine((call, context) => {
    if (
      call.manifest !== null &&
      call.manifest !== undefined &&
      (call.manifest.provider !== call.provider ||
        call.manifest.model !== call.model ||
        call.manifest.destination !== call.destination ||
        (call.endpointOrigin !== null && call.manifest.endpointOrigin !== call.endpointOrigin))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Failure manifest must match the provider configuration',
        path: ['manifest'],
      });
    }
    if (
      call.completedExecutions?.some(
        (execution) =>
          execution.provider !== call.provider ||
          execution.model !== call.model ||
          execution.destination !== call.destination ||
          execution.errorCode !== null,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Completed executions must match the failed provider configuration',
        path: ['completedExecutions'],
      });
    }
    if (
      call.failedExecution !== undefined &&
      (call.failedExecution.provider !== call.provider ||
        call.failedExecution.model !== call.model ||
        call.failedExecution.operation !== call.operation ||
        call.failedExecution.destination !== call.destination ||
        call.failedExecution.errorCode !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Failed execution metadata must match the provider configuration',
        path: ['failedExecution'],
      });
    }
    if (new Date(call.completedAt).getTime() < new Date(call.startedAt).getTime()) {
      context.addIssue({
        code: 'custom',
        message: 'Completion cannot precede start',
        path: ['completedAt'],
      });
    }
  });

export type ProviderId = z.infer<typeof ProviderIdSchema>;
export type ProviderDestination = z.infer<typeof ProviderDestinationSchema>;
export type StructuredOutputMode = z.infer<typeof StructuredOutputModeSchema>;
export type ProviderErrorCode = z.infer<typeof ProviderErrorCodeSchema>;
export type ProviderOperation = z.infer<typeof ProviderOperationSchema>;
export type RedactionCategory = z.infer<typeof RedactionCategorySchema>;
export type RedactionConfig = z.infer<typeof RedactionConfigSchema>;
export type RedactionSummary = z.infer<typeof RedactionSummarySchema>;
export type ProviderRates = z.infer<typeof ProviderRatesSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type TransmissionDataCategory = z.infer<typeof TransmissionDataCategorySchema>;
export type TransmissionManifest = z.infer<typeof TransmissionManifestSchema>;
export type ProviderUsage = z.infer<typeof ProviderUsageSchema>;
export type ProviderExecutionMetadata = z.infer<typeof ProviderExecutionMetadataSchema>;
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;
export type ProviderSummary = z.infer<typeof ProviderSummarySchema>;
export type RequirementAnalysisInput = z.infer<typeof RequirementAnalysisInputSchema>;
export type RequirementAnalysisOutput = z.infer<typeof RequirementAnalysisOutputSchema>;
export type EvidenceMappingInput = z.infer<typeof EvidenceMappingInputSchema>;
export type EvidenceMappingOutput = z.infer<typeof EvidenceMappingOutputSchema>;
export type InterviewTopic = z.infer<typeof InterviewTopicSchema>;
export type ApplicationSuggestionInput = z.infer<typeof ApplicationSuggestionInputSchema>;
export type ApplicationSuggestionOutput = z.infer<typeof ApplicationSuggestionOutputSchema>;
export type AIEnhancement = z.infer<typeof AIEnhancementSchema>;
export type EnhancedAnalysisEnvelope = z.infer<typeof EnhancedAnalysisEnvelopeSchema>;
export type StoredProviderCall = z.infer<typeof StoredProviderCallSchema>;
export type StoredAIEnhancement = z.infer<typeof StoredAIEnhancementSchema>;
export type ProviderCallFailureInput = z.infer<typeof ProviderCallFailureInputSchema>;

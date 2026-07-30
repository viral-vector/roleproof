import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AIEnhancementSchema,
  AnalysisEnvelopeSchema,
  AnalysisResultSchema,
  ApplicationSuggestionInputSchema,
  ApplicationSuggestionOutputSchema,
  EvidenceMappingInputSchema,
  EvidenceMappingOutputSchema,
  EnhancedAnalysisEnvelopeSchema,
  ProviderConfigSchema,
  ProviderExecutionMetadataSchema,
  ProviderHealthSchema,
  ProviderSummarySchema,
  ProviderOperationSchema,
  ProviderCallFailureInputSchema,
  ProviderUsageSchema,
  RedactionConfigSchema,
  RequirementAnalysisInputSchema,
  RequirementAnalysisOutputSchema,
  TransmissionManifestSchema,
  StoredAIEnhancementSchema,
  StoredProviderCallSchema,
  type AIEnhancement,
  type EnhancedAnalysisEnvelope,
  type ProviderConfig,
} from '../src/index.js';

const redactionConfig = {
  email: true,
  phone: true,
  address: true,
  confidentialEmployerNames: false,
  clearanceDetails: true,
  userSelectedTerms: ['Project Cobalt'],
} as const;

const providerConfig = {
  provider: 'openai',
  model: 'gpt-fictional',
  baseUrl: null,
  destination: 'hosted',
  requestTimeoutMs: 30_000,
  maxInputChars: 40_000,
  maxOutputTokens: 2_000,
  maxTotalTokens: 12_000,
  maxCostMicroUsd: 250_000,
  rates: {
    inputMicroUsdPerMillionTokens: 100_000,
    outputMicroUsdPerMillionTokens: 200_000,
  },
  structuredOutputMode: 'json-schema',
  redaction: redactionConfig,
} as const;

const requirementInput = {
  baselineAnalysisId: 'analysis-1',
  requirements: [
    {
      requirementId: 'requirement-1',
      text: 'Production TypeScript experience is required.',
      importance: 'required',
      baselineClassification: 'direct',
      evidenceIds: ['evidence-1'],
    },
  ],
  redactedJobSummary: 'A fictional backend role requiring TypeScript.',
} as const;

const requirementOutput = {
  requirements: [
    {
      requirementId: 'requirement-1',
      baselineClassification: 'direct',
      classification: 'direct',
      evidenceIds: ['evidence-1'],
      explanation: 'The supplied evidence explicitly names TypeScript.',
    },
  ],
} as const;

const evidenceInput = {
  baselineAnalysisId: 'analysis-1',
  requirements: requirementInput.requirements,
  evidence: [
    {
      evidenceId: 'evidence-1',
      redactedSummary: 'Built fictional TypeScript services.',
    },
  ],
} as const;

const evidenceOutput = {
  mappings: [
    {
      requirementId: 'requirement-1',
      baselineClassification: 'direct',
      classification: 'direct',
      evidenceIds: ['evidence-1'],
      explanation: 'The evidence directly supports the requirement.',
    },
  ],
} as const;

const applicationInput = {
  baselineAnalysisId: 'analysis-1',
  requirements: requirementInput.requirements,
  evidence: evidenceInput.evidence,
  redactedResumeSummary: 'Backend engineer with fictional TypeScript work.',
  redactedJobSummary: 'A fictional backend TypeScript role.',
} as const;

const applicationOutput = {
  suggestedEmphasis: [
    {
      text: 'Emphasize the TypeScript service work.',
      classification: 'direct',
      evidenceIds: ['evidence-1'],
      explanation: 'The evidence directly supports this emphasis.',
    },
  ],
  suggestedAdditions: [
    {
      text: 'Confirm whether mentoring should be added.',
      classification: 'requires-user-confirmation',
      evidenceIds: [],
      explanation: 'The supplied summary is ambiguous.',
    },
  ],
  interviewTopics: [
    {
      topic: 'TypeScript service design',
      evidenceIds: ['evidence-1'],
      rationale: 'Discuss the evidenced service work.',
    },
  ],
  coverLetterAngles: [
    {
      text: 'Connect the evidenced TypeScript work to the role.',
      evidenceIds: ['evidence-1'],
    },
  ],
} as const;

const manifest = {
  provider: 'openai',
  model: 'gpt-fictional',
  destination: 'hosted',
  endpointOrigin: 'https://api.openai.com',
  dataCategories: ['job-summary', 'resume-summary', 'evidence-summary'],
  redactionApplied: true,
  redactionSummary: {
    categories: ['email', 'phone'],
    replacementCount: 2,
    inputChars: 500,
    outputChars: 450,
  },
} as const;

const execution = {
  operation: 'analyze-requirements',
  provider: 'openai',
  model: 'gpt-fictional',
  destination: 'hosted',
  manifest,
  usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140, costMicroUsd: 18_000 },
  errorCode: null,
} as const;

describe('Phase 3 provider configuration and privacy schemas', () => {
  it('accepts a bounded credential-free provider configuration and exports its type', () => {
    const parsed = ProviderConfigSchema.parse(providerConfig);

    expect(parsed).toEqual(providerConfig);
    expectTypeOf(parsed).toEqualTypeOf<ProviderConfig>();
    expect(ProviderConfigSchema.safeParse({ ...providerConfig, apiKey: 'secret' }).success).toBe(
      false,
    );
    expect(
      ProviderConfigSchema.safeParse({ ...providerConfig, maxInputChars: 1_000_001 }).success,
    ).toBe(false);
  });

  it('validates deterministic redaction and content-free transmission metadata', () => {
    expect(RedactionConfigSchema.parse(redactionConfig)).toEqual(redactionConfig);
    expect(TransmissionManifestSchema.parse(manifest)).toEqual(manifest);
    expect(
      TransmissionManifestSchema.safeParse({
        ...manifest,
        endpointOrigin: 'https://api.openai.com/v1',
      }).success,
    ).toBe(false);
    expect(
      TransmissionManifestSchema.safeParse({ ...manifest, resumeText: 'private content' }).success,
    ).toBe(false);
  });

  it('allows stable redaction placeholders to expand output within the independent bound', () => {
    expect(
      TransmissionManifestSchema.safeParse({
        ...manifest,
        redactionSummary: {
          categories: ['email'],
          replacementCount: 1,
          inputChars: 3,
          outputChars: 18,
        },
      }).success,
    ).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'rejects invalid provider usage values: %s',
    (inputTokens) => {
      expect(
        ProviderUsageSchema.safeParse({
          inputTokens,
          outputTokens: 0,
          totalTokens: 0,
          costMicroUsd: null,
        }).success,
      ).toBe(false);
    },
  );

  it('requires internally consistent nullable usage and bounded execution metadata', () => {
    expect(ProviderExecutionMetadataSchema.parse(execution)).toEqual(execution);
    expect(
      ProviderUsageSchema.safeParse({
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 4,
        costMicroUsd: null,
      }).success,
    ).toBe(false);
    expect(ProviderOperationSchema.safeParse('change-score').success).toBe(false);
  });

  it('validates provider health without exposing arbitrary provider payloads', () => {
    const health = {
      provider: 'openai-compatible',
      destination: 'local',
      status: 'healthy',
      latencyMs: 12,
      errorCode: null,
      message: null,
    } as const;

    expect(ProviderHealthSchema.parse(health)).toEqual(health);
    expect(ProviderHealthSchema.safeParse({ ...health, response: { models: [] } }).success).toBe(
      false,
    );
  });
});

describe('Phase 3 provider operation schemas', () => {
  it('validates strict requirement analysis inputs and evidence-linked outputs', () => {
    expect(RequirementAnalysisInputSchema.parse(requirementInput)).toEqual(requirementInput);
    expect(RequirementAnalysisOutputSchema.parse(requirementOutput)).toEqual(requirementOutput);
    expect(
      RequirementAnalysisInputSchema.safeParse({ ...requirementInput, baselineScore: 82 }).success,
    ).toBe(false);
    expect(
      RequirementAnalysisOutputSchema.safeParse({
        requirements: [{ ...requirementOutput.requirements[0], evidenceIds: [] }],
      }).success,
    ).toBe(false);
  });

  it('rejects malformed IDs and unsupported-to-direct upgrades', () => {
    expect(
      RequirementAnalysisInputSchema.safeParse({
        ...requirementInput,
        baselineAnalysisId: 'bad id',
      }).success,
    ).toBe(false);
    expect(
      RequirementAnalysisOutputSchema.safeParse({
        requirements: [
          {
            ...requirementOutput.requirements[0],
            baselineClassification: 'unsupported',
            classification: 'direct',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('validates evidence mapping inputs and outputs without scoring controls', () => {
    expect(EvidenceMappingInputSchema.parse(evidenceInput)).toEqual(evidenceInput);
    expect(EvidenceMappingOutputSchema.parse(evidenceOutput)).toEqual(evidenceOutput);
    expect(
      EvidenceMappingOutputSchema.safeParse({ ...evidenceOutput, weights: { direct: 1 } }).success,
    ).toBe(false);
  });

  it('requires evidence for application recommendations and interview topics', () => {
    expect(ApplicationSuggestionInputSchema.parse(applicationInput)).toEqual(applicationInput);
    expect(ApplicationSuggestionOutputSchema.parse(applicationOutput)).toEqual(applicationOutput);
    expect(
      ApplicationSuggestionOutputSchema.safeParse({
        ...applicationOutput,
        interviewTopics: [{ ...applicationOutput.interviewTopics[0], evidenceIds: [] }],
      }).success,
    ).toBe(false);
    expect(
      ApplicationSuggestionOutputSchema.safeParse({
        ...applicationOutput,
        suggestedEmphasis: [{ ...applicationOutput.suggestedEmphasis[0], evidenceIds: [] }],
      }).success,
    ).toBe(false);
    expect(
      ApplicationSuggestionOutputSchema.safeParse({
        ...applicationOutput,
        suggestedAdditions: [
          {
            ...applicationOutput.suggestedAdditions[0],
            classification: 'unknown',
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('AI enhancement sidecar compatibility', () => {
  const enhancement = {
    schemaVersion: '1.0',
    baselineAnalysisId: 'analysis-1',
    requirementAnalysis: requirementOutput,
    evidenceMapping: evidenceOutput,
    applicationSuggestions: applicationOutput,
    providerExecutions: [execution],
  } as const;

  const oldAnalysis = {
    schemaVersion: '1.0',
    id: 'analysis-1',
    overallScore: 82,
    recommendation: 'apply',
    confidence: 0.9,
    hardBlockers: [],
    matchedRequirements: [],
    missingRequirements: [],
    unsupportedClaims: [],
    suggestedEmphasis: [],
    suggestedAdditions: [],
    interviewTopics: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
    metadata: { mode: 'deterministic', engineVersion: '0.2.0' },
  } as const;

  it('validates a version 1.0 sidecar and exports its type', () => {
    const parsed = AIEnhancementSchema.parse(enhancement);

    expect(parsed).toEqual(enhancement);
    expectTypeOf(parsed).toEqualTypeOf<AIEnhancement>();
  });

  it.each(['overallScore', 'recommendation', 'hardBlockers'])(
    'rejects sidecar field %s',
    (field) => {
      expect(AIEnhancementSchema.safeParse({ ...enhancement, [field]: [] }).success).toBe(false);
    },
  );

  it('leaves the Phase 2 AnalysisResult and AnalysisEnvelope 1.0 contracts unchanged', () => {
    expect(AnalysisResultSchema.parse(oldAnalysis)).toEqual(oldAnalysis);
    expect(AnalysisEnvelopeSchema.parse({ schemaVersion: '1.0', analysis: oldAnalysis })).toEqual({
      schemaVersion: '1.0',
      analysis: oldAnalysis,
    });
    expect(
      AnalysisResultSchema.safeParse({ ...oldAnalysis, aiEnhancement: enhancement }).success,
    ).toBe(false);
  });

  it('validates a strict enhanced envelope without duplicating deterministic scores', () => {
    const envelope = {
      schemaVersion: '2.0',
      analysis: oldAnalysis,
      aiEnhancement: enhancement,
    } as const;
    const parsed = EnhancedAnalysisEnvelopeSchema.parse(envelope);

    expect(parsed).toEqual(envelope);
    expectTypeOf(parsed).toEqualTypeOf<EnhancedAnalysisEnvelope>();
    expect(
      EnhancedAnalysisEnvelopeSchema.safeParse({ ...envelope, schemaVersion: '1.0' }).success,
    ).toBe(false);
    expect(
      EnhancedAnalysisEnvelopeSchema.safeParse({ ...envelope, overallScore: 82 }).success,
    ).toBe(false);
    expect(
      EnhancedAnalysisEnvelopeSchema.safeParse({
        ...envelope,
        aiEnhancement: { ...enhancement, baselineAnalysisId: 'analysis-2' },
      }).success,
    ).toBe(false);
  });
});

describe('provider command boundary schemas', () => {
  it('accepts strict credential-free provider summaries', () => {
    const summary = {
      provider: 'openai',
      model: 'gpt-fictional',
      destination: 'hosted',
      configured: true,
    } as const;

    expect(ProviderSummarySchema.parse(summary)).toEqual(summary);
    expect(ProviderSummarySchema.safeParse({ ...summary, apiKey: 'secret' }).success).toBe(false);
  });
});

describe('Phase 3 storage schemas', () => {
  it('validates strict sanitized provider calls with nullable usage and cost', () => {
    const call = {
      schemaVersion: '1.0',
      id: 'call-abc123',
      baselineAnalysisId: 'analysis-1',
      provider: 'openai',
      model: 'gpt-fictional',
      operation: 'analyze-requirements',
      destination: 'hosted',
      endpointOrigin: 'https://api.openai.com',
      status: 'succeeded',
      errorCode: null,
      redactionApplied: true,
      redactionCategories: ['email'],
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costMicroUsd: null,
      requestId: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    } as const;

    expect(StoredProviderCallSchema.parse(call)).toEqual(call);
    expect(StoredProviderCallSchema.safeParse({ ...call, prompt: 'private' }).success).toBe(false);
    expect(StoredProviderCallSchema.safeParse({ ...call, apiKey: 'secret' }).success).toBe(false);
  });

  it('validates immutable stored enhancement envelopes without changing AnalysisResult', () => {
    const stored = {
      schemaVersion: '1.0',
      baselineAnalysisId: 'analysis-1',
      configFingerprint: `provider-config-${'a'.repeat(64)}`,
      enhancement: {
        schemaVersion: '1.0',
        baselineAnalysisId: 'analysis-1',
        requirementAnalysis: requirementOutput,
        evidenceMapping: evidenceOutput,
        applicationSuggestions: applicationOutput,
        providerExecutions: [execution],
      },
      createdAt: '2026-01-01T00:00:00.000Z',
    } as const;

    expect(StoredAIEnhancementSchema.parse(stored)).toEqual(stored);
    expect(
      StoredAIEnhancementSchema.safeParse({
        ...stored,
        baselineAnalysisId: 'analysis-2',
      }).success,
    ).toBe(false);
  });

  it('rejects private fields from failure recording inputs', () => {
    const failure = {
      baselineAnalysisId: 'analysis-1',
      provider: 'openai-compatible',
      model: 'local-fictional',
      operation: 'map-evidence',
      destination: 'local',
      endpointOrigin: 'http://localhost:11434',
      errorCode: 'timeout',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1_000,
      requestId: null,
    } as const;

    expect(ProviderCallFailureInputSchema.parse(failure)).toEqual(failure);
    for (const privateField of ['prompt', 'rawResponse', 'apiKey', 'substitutionMap']) {
      expect(
        ProviderCallFailureInputSchema.safeParse({
          ...failure,
          [privateField]: 'DO-NOT-PERSIST',
        }).success,
      ).toBe(false);
    }
  });
});

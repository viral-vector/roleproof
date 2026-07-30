import { describe, expect, it, vi } from 'vitest';

import type {
  AnalysisResult,
  ApplicationSuggestionInput,
  ApplicationSuggestionOutput,
  CareerEvidence,
  EvidenceMappingInput,
  EvidenceMappingOutput,
  JobRequirement,
  ProviderConfig,
  ProviderExecutionMetadata,
  ProviderHealth,
  ProviderOperation,
  ProviderUsage,
  RequirementAnalysisInput,
  RequirementAnalysisOutput,
  TransmissionDataCategory,
  TransmissionManifest,
} from '@roleproof/shared';

import {
  MAX_PROVIDER_INPUT_ITEMS,
  ProviderError,
  buildProviderInputs,
  buildTransmissionManifest,
  calculateUsageCost,
  createProviderConfig,
  enhanceAnalysis,
  enhanceAnalysisWithFallback,
  redactProviderInputs,
  redactText,
  sanitizeProviderError,
  type AIProvider,
  type ProviderCallContext,
  type ProviderResult,
} from '../src/index.js';

const config: ProviderConfig = {
  provider: 'openai-compatible',
  model: 'fictional-model',
  baseUrl: 'http://localhost:11434/v1/chat',
  destination: 'local',
  requestTimeoutMs: 1_000,
  maxInputChars: 100_000,
  maxOutputTokens: 1_000,
  maxTotalTokens: 10_000,
  maxCostMicroUsd: 10_000,
  rates: { inputMicroUsdPerMillionTokens: 1_000_000, outputMicroUsdPerMillionTokens: 2_000_000 },
  structuredOutputMode: 'json-schema',
  redaction: {
    email: true,
    phone: true,
    address: true,
    confidentialEmployerNames: true,
    clearanceDetails: true,
    userSelectedTerms: ['Cobalt', 'Project Cobalt'],
  },
};

const requirements: RequirementAnalysisInput = {
  baselineAnalysisId: 'analysis-1',
  requirements: [
    {
      requirementId: 'req-1',
      text: 'TypeScript',
      importance: 'required',
      baselineClassification: 'direct',
      evidenceIds: ['ev-1'],
    },
    {
      requirementId: 'req-2',
      text: 'Leadership',
      importance: 'preferred',
      baselineClassification: 'unknown',
      evidenceIds: [],
    },
  ],
  redactedJobSummary: 'A fictional role.',
};

const evidence: EvidenceMappingInput = {
  baselineAnalysisId: 'analysis-1',
  requirements: requirements.requirements,
  evidence: [{ evidenceId: 'ev-1', redactedSummary: 'Built TypeScript services.' }],
};

const suggestions: ApplicationSuggestionInput = {
  ...evidence,
  redactedResumeSummary: 'Backend engineer.',
  redactedJobSummary: 'A fictional role.',
};

const requirementOutput: RequirementAnalysisOutput = {
  requirements: [
    {
      requirementId: 'req-2',
      baselineClassification: 'unknown',
      classification: 'unknown',
      evidenceIds: [],
      explanation: 'No evidence supplied.',
    },
    {
      requirementId: 'req-1',
      baselineClassification: 'direct',
      classification: 'direct',
      evidenceIds: ['ev-1'],
      explanation: 'Explicit evidence.',
    },
  ],
};

const mappingOutput: EvidenceMappingOutput = {
  mappings: [...requirementOutput.requirements],
};

const suggestionOutput: ApplicationSuggestionOutput = {
  suggestedEmphasis: [
    {
      text: 'Emphasize TypeScript.',
      classification: 'direct',
      evidenceIds: ['ev-1', 'ev-1'],
      explanation: 'Supported.',
    },
  ],
  suggestedAdditions: [],
  interviewTopics: [{ topic: 'Services', evidenceIds: ['ev-1'], rationale: 'Supported.' }],
  coverLetterAngles: [{ text: 'Service delivery', evidenceIds: ['ev-1'] }],
};

const operationCategories: Record<ProviderOperation, TransmissionDataCategory[]> = {
  'analyze-requirements': ['job-summary', 'requirement-text', 'baseline-classification'],
  'map-evidence': ['requirement-text', 'evidence-summary', 'baseline-classification'],
  'suggest-application-changes': [
    'job-summary',
    'resume-summary',
    'requirement-text',
    'evidence-summary',
    'baseline-classification',
  ],
  'health-check': [],
};

const metadata = (
  operation: ProviderOperation,
  manifest?: TransmissionManifest,
  usage: ProviderUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicroUsd: 20 },
): ProviderExecutionMetadata => ({
  operation,
  provider: config.provider,
  model: config.model,
  destination: config.destination,
  manifest:
    manifest ??
    buildTransmissionManifest(config, config.baseUrl!, operationCategories[operation], {
      categories: [],
      replacementCount: 0,
      inputChars: 100,
      outputChars: 100,
    }),
  usage,
  errorCode: null,
});

const result = <T>(
  operation: ProviderOperation,
  output: T,
  manifest?: TransmissionManifest,
): ProviderResult<T> => ({
  output,
  metadata: metadata(operation, manifest),
});

class MockProvider implements AIProvider {
  readonly id = config.provider;
  readonly config = config;
  readonly endpointOrigin = new URL(config.baseUrl!).origin;

  analyzeRequirements = vi.fn((context: ProviderCallContext<RequirementAnalysisInput>) =>
    Promise.resolve(result('analyze-requirements', requirementOutput, context.manifest)),
  );
  mapEvidence = vi.fn((context: ProviderCallContext<EvidenceMappingInput>) =>
    Promise.resolve(result('map-evidence', mappingOutput, context.manifest)),
  );
  suggestApplicationChanges = vi.fn((context: ProviderCallContext<ApplicationSuggestionInput>) =>
    Promise.resolve(result('suggest-application-changes', suggestionOutput, context.manifest)),
  );
  healthCheck = vi.fn((): Promise<ProviderResult<ProviderHealth>> =>
    Promise.resolve(
      result('health-check', {
        provider: config.provider,
        destination: config.destination,
        status: 'healthy',
        latencyMs: 1,
        errorCode: null,
        message: null,
      }),
    ),
  );
}

const baseline: AnalysisResult = {
  schemaVersion: '1.0',
  id: 'analysis-1',
  overallScore: 10,
  recommendation: 'skip',
  confidence: 0.8,
  hardBlockers: ['Work authorization is required.'],
  matchedRequirements: [],
  missingRequirements: [],
  unsupportedClaims: [],
  suggestedEmphasis: [],
  suggestedAdditions: [],
  interviewTopics: [],
  generatedAt: '2026-01-01T00:00:00.000Z',
  metadata: { mode: 'deterministic', engineVersion: '0.2.0' },
};

const inputRequirements: JobRequirement[] = [
  {
    id: 'req-2',
    category: 'leadership',
    text: 'Lead a delivery team.',
    importance: 'preferred',
  },
  {
    id: 'req-1',
    category: 'language',
    text: 'Use TypeScript in production.',
    importance: 'required',
  },
];

const inputEvidence: CareerEvidence[] = [
  {
    id: 'ev-unrelated',
    profileId: 'profile-1',
    category: 'domain',
    name: 'Unrelated private history',
    description: 'DO-NOT-SEND unrelated resume content.',
    sourceDocumentId: 'resume-1',
    confidence: 'explicit',
  },
  {
    id: 'ev-1',
    profileId: 'profile-1',
    category: 'skill',
    name: 'TypeScript',
    description: 'Built typed services.',
    sourceDocumentId: 'resume-1',
    sourceText: 'Delivered production TypeScript APIs.',
    confidence: 'explicit',
  },
];

const inputBaseline: AnalysisResult = {
  ...baseline,
  matchedRequirements: [
    {
      requirementId: 'req-2',
      evidenceIds: [],
      classification: 'unknown',
      score: 0,
      explanation: 'No supplied evidence confirms leadership.',
    },
    {
      requirementId: 'req-1',
      evidenceIds: ['ev-1', 'ev-1'],
      classification: 'direct',
      score: 1,
      explanation: 'Explicit TypeScript evidence.',
    },
  ],
};

describe('provider configuration and deterministic input construction', () => {
  it('creates credential-free, serializable safe defaults', () => {
    const created = createProviderConfig({
      provider: 'openai',
      model: 'fictional-model',
      destination: 'hosted',
    });

    expect(created).toEqual({
      provider: 'openai',
      model: 'fictional-model',
      baseUrl: null,
      destination: 'hosted',
      requestTimeoutMs: 60_000,
      maxInputChars: 100_000,
      maxOutputTokens: 4_000,
      maxTotalTokens: 16_000,
      maxCostMicroUsd: null,
      rates: null,
      structuredOutputMode: 'json-schema',
      redaction: {
        email: true,
        phone: true,
        address: true,
        confidentialEmployerNames: false,
        clearanceDetails: false,
        userSelectedTerms: [],
      },
    });
    expect(JSON.parse(JSON.stringify(created))).toEqual(created);
    expect(created).not.toHaveProperty('apiKey');
  });

  it('rejects a cost ceiling without rates at the canonical config boundary', () => {
    expect(() =>
      createProviderConfig({
        provider: 'openai',
        model: 'fictional-model',
        destination: 'hosted',
        maxCostMicroUsd: 1,
      }),
    ).toThrowError(ProviderError);
  });

  it('builds stable minimal inputs with identical requirements and selected evidence only', () => {
    const first = buildProviderInputs(inputBaseline, inputRequirements, inputEvidence);
    const second = buildProviderInputs(
      structuredClone(inputBaseline),
      [...inputRequirements].reverse(),
      [...inputEvidence].reverse(),
    );

    expect(second).toEqual(first);
    expect(first.requirementAnalysis.requirements).toEqual(first.evidenceMapping.requirements);
    expect(first.requirementAnalysis.requirements).toEqual(
      first.applicationSuggestions.requirements,
    );
    expect(first.requirementAnalysis.requirements).toEqual([
      {
        requirementId: 'req-1',
        text: 'Use TypeScript in production.',
        importance: 'required',
        baselineClassification: 'direct',
        evidenceIds: ['ev-1'],
      },
      {
        requirementId: 'req-2',
        text: 'Lead a delivery team.',
        importance: 'preferred',
        baselineClassification: 'unknown',
        evidenceIds: [],
      },
    ]);
    expect(first.evidenceMapping.evidence).toEqual([
      {
        evidenceId: 'ev-1',
        redactedSummary: 'Built typed services. Delivered production TypeScript APIs.',
      },
    ]);
    expect(JSON.stringify(first)).not.toContain('DO-NOT-SEND');
    expect(first.requirementAnalysis.redactedJobSummary).toBe(
      'Use TypeScript in production.\nLead a delivery team.',
    );
    expect(first.applicationSuggestions.redactedResumeSummary).toBe(
      'Built typed services. Delivered production TypeScript APIs.',
    );
  });

  it('caps provider items deterministically without mutating the baseline', () => {
    const manyRequirements = Array.from({ length: MAX_PROVIDER_INPUT_ITEMS + 1 }, (_, index) => ({
      id: `req-${String(index).padStart(3, '0')}`,
      category: 'other' as const,
      text: `Requirement ${index}`,
      importance: 'contextual' as const,
    }));
    const manyBaseline: AnalysisResult = {
      ...baseline,
      matchedRequirements: manyRequirements.map((requirement) => ({
        requirementId: requirement.id,
        evidenceIds: [],
        classification: 'unsupported' as const,
        score: 0,
        explanation: 'No evidence.',
      })),
    };
    const before = structuredClone(manyBaseline);

    const built = buildProviderInputs(manyBaseline, manyRequirements, []);

    expect(built.requirementAnalysis.requirements).toHaveLength(MAX_PROVIDER_INPUT_ITEMS);
    expect(built.requirementAnalysis.requirements.at(-1)?.requirementId).toBe('req-099');
    expect(manyBaseline).toEqual(before);
  });

  it('throws a sanitized configuration error for malformed or inconsistent baseline references', () => {
    const inconsistent = {
      ...inputBaseline,
      matchedRequirements: [
        { ...inputBaseline.matchedRequirements[0]!, requirementId: 'missing requirement/private' },
      ],
    };

    expect(() => buildProviderInputs(inconsistent, inputRequirements, inputEvidence)).toThrowError(
      new ProviderError('configuration', 'analyze-requirements'),
    );
    expect(() => buildProviderInputs(inconsistent, inputRequirements, inputEvidence)).not.toThrow(
      /private/u,
    );
  });
});

describe('provider-neutral contract and validation', () => {
  it('publishes a validated, sorted and deduplicated atomic sidecar', async () => {
    const provider = new MockProvider();
    const enhancement = await enhanceAnalysis(provider, requirements, evidence, suggestions);

    expect(enhancement.requirementAnalysis.requirements.map((item) => item.requirementId)).toEqual([
      'req-1',
      'req-2',
    ]);
    expect(enhancement.applicationSuggestions.suggestedEmphasis[0]?.evidenceIds).toEqual(['ev-1']);
    expect(enhancement.providerExecutions).toHaveLength(3);
    expect(provider.analyzeRequirements).toHaveBeenCalledBefore(provider.mapEvidence);
    expect(provider.mapEvidence).toHaveBeenCalledBefore(provider.suggestApplicationChanges);
  });

  it('redacts each operation before invocation and supplies an immutable exact manifest', async () => {
    const provider = new MockProvider();
    const privateRequirements = structuredClone(requirements);
    privateRequirements.requirements[0]!.text =
      'person@example.test +1 (555) 010-1234 Hidden Labs Project Cobalt';
    const privateEvidence = { ...evidence, requirements: privateRequirements.requirements };
    const privateSuggestions = { ...suggestions, requirements: privateRequirements.requirements };

    await enhanceAnalysis(provider, privateRequirements, privateEvidence, privateSuggestions, [
      'Hidden Labs',
    ]);

    const context = provider.analyzeRequirements.mock.calls[0]![0];
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.input)).toBe(true);
    expect(Object.isFrozen(context.manifest)).toBe(true);
    expect(context.manifest.redactionSummary.categories).toEqual([
      'email',
      'phone',
      'confidential-employer-name',
      'user-selected-term',
    ]);
    for (const privateValue of [
      'person@example.test',
      '+1 (555) 010-1234',
      'Hidden Labs',
      'Project Cobalt',
    ]) {
      expect(JSON.stringify(context)).not.toContain(privateValue);
    }
  });

  it('rejects metadata unless its manifest exactly equals the supplied manifest', async () => {
    const provider = new MockProvider();
    provider.analyzeRequirements.mockImplementationOnce((context) =>
      Promise.resolve({
        output: requirementOutput,
        metadata: {
          ...metadata('analyze-requirements', context.manifest),
          manifest: {
            ...context.manifest,
            redactionSummary: { ...context.manifest.redactionSummary, inputChars: 999 },
          },
        },
      }),
    );

    await expect(
      enhanceAnalysis(provider, requirements, evidence, suggestions),
    ).rejects.toMatchObject({
      code: 'invalid-output',
      operation: 'analyze-requirements',
    });
  });

  it.each([
    ['missing requirement', { requirements: [requirementOutput.requirements[0]] }],
    [
      'unknown requirement',
      {
        requirements: [
          ...requirementOutput.requirements,
          { ...requirementOutput.requirements[0], requirementId: 'req-unknown' },
        ],
      },
    ],
    [
      'duplicate requirement',
      { requirements: [requirementOutput.requirements[0], requirementOutput.requirements[0]] },
    ],
    [
      'baseline mismatch',
      {
        requirements: requirementOutput.requirements.map((item) =>
          item.requirementId === 'req-2'
            ? { ...item, baselineClassification: 'unsupported' as const }
            : item,
        ),
      },
    ],
    [
      'unknown evidence',
      {
        requirements: requirementOutput.requirements.map((item) =>
          item.requirementId === 'req-1' ? { ...item, evidenceIds: ['ev-unknown'] } : item,
        ),
      },
    ],
  ])('rejects %s output without invoking later operations', async (_name, output) => {
    const provider = new MockProvider();
    provider.analyzeRequirements.mockResolvedValueOnce(
      result('analyze-requirements', output as RequirementAnalysisOutput),
    );

    await expect(
      enhanceAnalysis(provider, requirements, evidence, suggestions),
    ).rejects.toMatchObject({
      code: 'invalid-output',
      operation: 'analyze-requirements',
    });
    expect(provider.mapEvidence).not.toHaveBeenCalled();
  });

  it('rejects a direct upgrade and malformed provider output', async () => {
    for (const output of [
      { requirements: 'not-an-array' },
      {
        requirements: requirementOutput.requirements.map((item) =>
          item.requirementId === 'req-2'
            ? { ...item, classification: 'direct', evidenceIds: ['ev-1'] }
            : item,
        ),
      },
    ]) {
      const provider = new MockProvider();
      provider.analyzeRequirements.mockResolvedValueOnce(
        result('analyze-requirements', output as RequirementAnalysisOutput),
      );
      await expect(
        enhanceAnalysis(provider, requirements, evidence, suggestions),
      ).rejects.toMatchObject({ code: 'invalid-output' });
    }
  });

  it.each(['suggestedEmphasis', 'interviewTopics', 'coverLetterAngles'] as const)(
    'rejects unknown evidence in %s',
    async (field) => {
      const provider = new MockProvider();
      const bad = structuredClone(suggestionOutput);
      bad[field][0]!.evidenceIds = ['ev-unknown'];
      provider.suggestApplicationChanges.mockResolvedValueOnce(
        result('suggest-application-changes', bad),
      );
      await expect(
        enhanceAnalysis(provider, requirements, evidence, suggestions),
      ).rejects.toMatchObject({ code: 'invalid-output' });
    },
  );

  it('rejects AI-authored additions presented as confirmed experience', async () => {
    const provider = new MockProvider();
    provider.suggestApplicationChanges.mockResolvedValueOnce(
      result('suggest-application-changes', {
        ...suggestionOutput,
        suggestedAdditions: [
          {
            text: 'Add ten years of Kubernetes architecture ownership.',
            classification: 'direct',
            evidenceIds: ['ev-1'],
            explanation: 'Cites unrelated evidence.',
          },
        ],
      }),
    );

    await expect(
      enhanceAnalysis(provider, requirements, evidence, suggestions),
    ).rejects.toMatchObject({ code: 'invalid-output' });
  });

  it('rejects metadata that does not match provider config, operation, and manifest', async () => {
    const provider = new MockProvider();
    provider.analyzeRequirements.mockResolvedValueOnce({
      output: requirementOutput,
      metadata: { ...metadata('map-evidence'), model: 'wrong-model' },
    });
    await expect(
      enhanceAnalysis(provider, requirements, evidence, suggestions),
    ).rejects.toMatchObject({
      code: 'invalid-output',
    });
  });

  it('rejects operation inputs from different baseline analyses before provider calls', async () => {
    const provider = new MockProvider();
    await expect(
      enhanceAnalysis(
        provider,
        requirements,
        { ...evidence, baselineAnalysisId: 'analysis-2' },
        suggestions,
      ),
    ).rejects.toMatchObject({ code: 'configuration' });
    expect(provider.analyzeRequirements).not.toHaveBeenCalled();
  });
});

describe('privacy helpers', () => {
  it('redacts sensitive values deterministically with longest-first stable placeholders', () => {
    const privateText = [
      'Email: person@example.test',
      'Phone: +1 (555) 010-1234',
      'Address: 10 Fiction Lane, Example City',
      'Clearance: Top Secret',
      'Worked at Hidden Labs on Project Cobalt and Cobalt.',
    ].join('\n');
    const first = redactText(privateText, config.redaction, ['Hidden Labs']);
    const second = redactText(privateText, config.redaction, ['Hidden Labs']);

    expect(first).toEqual(second);
    for (const value of [
      'person@example.test',
      '+1 (555) 010-1234',
      '10 Fiction Lane',
      'Top Secret',
      'Hidden Labs',
      'Project Cobalt',
    ]) {
      expect(first.text).not.toContain(value);
      expect(JSON.stringify(first.summary)).not.toContain(value);
    }
    expect(first.text).toContain('[REDACTED_USER_SELECTED_TERM_1]');
    expect(first.summary.replacementCount).toBe(7);
    expect(first.summary.categories).toEqual([
      'email',
      'phone',
      'address',
      'confidential-employer-name',
      'clearance-detail',
      'user-selected-term',
    ]);
  });

  it('redacts common unlabeled addresses, international phones, and clearance phrases', () => {
    const value = redactText(
      ['10 Fiction Lane, Example City', '+44 20 7946 0958', 'Active TS/SCI clearance'].join('\n'),
      config.redaction,
    );

    expect(value.text).not.toContain('10 Fiction Lane');
    expect(value.text).not.toContain('+44 20 7946 0958');
    expect(value.text).not.toContain('TS/SCI');
    expect(value.summary.categories).toEqual(['phone', 'address', 'clearance-detail']);
  });

  it('supports redaction expansion and never exposes a substitution map', () => {
    const redacted = redactText('x@y.z', config.redaction, []);
    expect(redacted.text.length).toBeGreaterThan('x@y.z'.length);
    expect(redacted).not.toHaveProperty('substitutions');
    expect(redacted.summary.outputChars).toBe(redacted.text.length);
  });

  it('redacts all provider inputs without mutating them', () => {
    const privateInputs = structuredClone({ requirements, evidence, suggestions });
    privateInputs.requirements.redactedJobSummary = 'person@example.test Project Cobalt';
    privateInputs.evidence.evidence[0]!.redactedSummary = 'Hidden Labs +1 555 010 1234';
    const original = structuredClone(privateInputs);
    const redacted = redactProviderInputs(privateInputs, config.redaction, ['Hidden Labs']);

    expect(privateInputs).toEqual(original);
    expect(JSON.stringify(redacted)).not.toContain('person@example.test');
    expect(JSON.stringify(redacted)).not.toContain('Hidden Labs');
    expect(JSON.stringify(redacted)).not.toContain('Project Cobalt');
  });

  it('builds a content-free manifest containing endpoint origin only', () => {
    const built = buildTransmissionManifest(
      config,
      'https://example.test/v1/chat?secret=value',
      [],
      {
        categories: [],
        replacementCount: 0,
        inputChars: 1,
        outputChars: 1,
      },
    );
    expect(built.endpointOrigin).toBe('https://example.test');
    expect(JSON.stringify(built)).not.toContain('secret');
  });
});

describe('budgets, failures, and fallback', () => {
  it.each([
    [{ status: 401, message: 'private response body' }, 'auth'],
    [{ statusCode: 429, body: 'private response body' }, 'rate-limit'],
    [new Error('private response body'), 'unavailable'],
  ] as const)('maps failures to sanitized canonical errors', (failure, code) => {
    const error = sanitizeProviderError(failure, 'analyze-requirements');
    expect(error.code).toBe(code);
    expect(JSON.stringify(error)).not.toContain('private response body');
    expect(error).not.toHaveProperty('body');
  });

  it('computes cost only for integer rates and complete provider usage', () => {
    expect(calculateUsageCost(config.rates, { inputTokens: 10, outputTokens: 5 })).toBe(20);
    expect(calculateUsageCost(null, { inputTokens: 10, outputTokens: 5 })).toBeNull();
    expect(calculateUsageCost(config.rates, { inputTokens: null, outputTokens: 5 })).toBeNull();
  });

  it.each([
    ['maxTotalTokens', 10, { inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicroUsd: 20 }],
    [
      'maxCostMicroUsd',
      25,
      { inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicroUsd: 20 },
    ],
    ['maxInputChars', 150, { inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicroUsd: 20 }],
  ] as const)(
    'stops before a later call when aggregate %s is exceeded',
    async (field, limit, usage) => {
      const provider = new MockProvider();
      Object.defineProperty(provider, 'config', { value: { ...config, [field]: limit } });
      provider.analyzeRequirements.mockImplementationOnce((context) =>
        Promise.resolve({
          output: requirementOutput,
          metadata: metadata('analyze-requirements', context.manifest, usage),
        }),
      );
      if (field !== 'maxTotalTokens') {
        provider.mapEvidence.mockImplementationOnce((context) =>
          Promise.resolve({
            output: mappingOutput,
            metadata: metadata('map-evidence', context.manifest, usage),
          }),
        );
      }

      await expect(
        enhanceAnalysis(provider, requirements, evidence, suggestions),
      ).rejects.toMatchObject({
        code: 'budget-exceeded',
      });
      expect(provider.suggestApplicationChanges).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['timeout', 'timeout'],
    ['auth', 'auth'],
    ['rate-limit', 'rate-limit'],
  ] as const)(
    'returns a sanitized %s fallback with exact unchanged baseline',
    async (_case, code) => {
      const provider = new MockProvider();
      provider.analyzeRequirements.mockRejectedValueOnce(
        new ProviderError(code, 'analyze-requirements'),
      );
      const snapshot = structuredClone(baseline);
      const fallback = await enhanceAnalysisWithFallback(
        baseline,
        provider,
        requirements,
        evidence,
        suggestions,
      );

      expect(fallback.baseline).toBe(baseline);
      expect(fallback.baseline).toEqual(snapshot);
      expect(fallback.enhancement).toBeUndefined();
      expect(fallback.error).toMatchObject({ code, operation: 'analyze-requirements' });
      expect(JSON.stringify(fallback.error)).not.toContain('body');
      expect(fallback.baseline.hardBlockers).toEqual(['Work authorization is required.']);
    },
  );

  it('publishes no partial enhancement after a later provider failure', async () => {
    const provider = new MockProvider();
    provider.mapEvidence.mockRejectedValueOnce(new ProviderError('unavailable', 'map-evidence'));
    const fallback = await enhanceAnalysisWithFallback(
      baseline,
      provider,
      requirements,
      evidence,
      suggestions,
    );
    expect(fallback.enhancement).toBeUndefined();
    expect(provider.suggestApplicationChanges).not.toHaveBeenCalled();
  });

  it('retains usage for the completed call that crosses an aggregate budget', async () => {
    const provider = new MockProvider();
    Object.defineProperty(provider, 'config', { value: { ...config, maxTotalTokens: 25 } });
    const fallback = await enhanceAnalysisWithFallback(
      baseline,
      provider,
      requirements,
      evidence,
      suggestions,
    );

    expect(fallback.error).toMatchObject({ code: 'budget-exceeded', operation: 'map-evidence' });
    expect(fallback.completedExecutions).toHaveLength(1);
    expect(fallback.failedExecution?.usage.totalTokens).toBe(15);
  });

  it('rejects null custom-provider usage and retains per-call over-limit usage', async () => {
    const missingUsage = new MockProvider();
    missingUsage.analyzeRequirements.mockImplementationOnce((context) =>
      Promise.resolve({
        output: requirementOutput,
        metadata: metadata('analyze-requirements', context.manifest, {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          costMicroUsd: null,
        }),
      }),
    );
    await expect(
      enhanceAnalysis(missingUsage, requirements, evidence, suggestions),
    ).rejects.toMatchObject({ code: 'invalid-output' });

    const overLimit = new MockProvider();
    overLimit.analyzeRequirements.mockImplementationOnce((context) =>
      Promise.resolve({
        output: requirementOutput,
        metadata: metadata('analyze-requirements', context.manifest, {
          inputTokens: 10,
          outputTokens: 1_001,
          totalTokens: 1_011,
          costMicroUsd: 2_012,
        }),
      }),
    );
    const fallback = await enhanceAnalysisWithFallback(
      baseline,
      overLimit,
      requirements,
      evidence,
      suggestions,
    );
    expect(fallback.error).toMatchObject({ code: 'budget-exceeded' });
    expect(fallback.failedExecution?.usage.outputTokens).toBe(1_001);
  });

  it('applies confidential employer redaction through fallback orchestration', async () => {
    const provider = new MockProvider();
    const privateSuggestions = {
      ...suggestions,
      redactedResumeSummary: 'Worked at Hidden Labs.',
    };
    await enhanceAnalysisWithFallback(
      baseline,
      provider,
      requirements,
      evidence,
      privateSuggestions,
      ['Hidden Labs'],
    );

    const context = provider.suggestApplicationChanges.mock.calls[0]?.[0];
    expect(context?.input.redactedResumeSummary).not.toContain('Hidden Labs');
    expect(context?.manifest.redactionSummary.categories).toContain('confidential-employer-name');
  });

  it('does not fall back from a local provider to a hosted provider', async () => {
    const local = new MockProvider();
    local.analyzeRequirements.mockRejectedValueOnce(
      new ProviderError('unavailable', 'analyze-requirements'),
    );
    const hosted = new MockProvider();
    Object.defineProperty(hosted, 'config', {
      value: { ...config, destination: 'hosted', baseUrl: null },
    });

    await enhanceAnalysisWithFallback(baseline, local, requirements, evidence, suggestions);
    expect(hosted.analyzeRequirements).not.toHaveBeenCalled();
  });
});

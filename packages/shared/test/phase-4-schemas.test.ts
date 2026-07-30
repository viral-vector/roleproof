import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  LocalAnalyzeRequestSchema,
  LocalAnalyzeResponseSchema,
  type LocalAnalyzeRequest,
  type LocalAnalyzeResponse,
} from '../src/index.js';

describe('Phase 4 local API schemas', () => {
  it('validates deterministic local analyze requests without provider settings', () => {
    const request = {
      schemaVersion: '1.0',
      resumeText: 'Fictional resume with TypeScript.',
      jobText: 'Fictional job requiring TypeScript.',
    } as const;

    const parsed = LocalAnalyzeRequestSchema.parse(request);

    expect(parsed).toEqual({ ...request, mode: 'deterministic' });
    expectTypeOf(parsed).toEqualTypeOf<LocalAnalyzeRequest>();
    expect(LocalAnalyzeRequestSchema.safeParse({ ...request, provider: 'openai' }).success).toBe(
      false,
    );
    expect(LocalAnalyzeRequestSchema.safeParse({ ...request, resumeText: '   ' }).success).toBe(
      false,
    );
  });

  it('reuses the canonical deterministic analysis envelope for responses', () => {
    const response = {
      schemaVersion: '1.0',
      analysis: {
        schemaVersion: '1.0',
        id: 'analysis-local-api',
        overallScore: 0,
        recommendation: 'manual-review',
        confidence: 0,
        hardBlockers: [],
        matchedRequirements: [],
        missingRequirements: [],
        unsupportedClaims: [],
        suggestedEmphasis: [],
        suggestedAdditions: [],
        interviewTopics: [],
        generatedAt: '2026-01-01T00:00:00.000Z',
        metadata: { mode: 'deterministic', engineVersion: '0.3.0' },
      },
    } as const;

    const parsed = LocalAnalyzeResponseSchema.parse(response);

    expect(parsed).toEqual(response);
    expectTypeOf(parsed).toEqualTypeOf<LocalAnalyzeResponse>();
    expect(
      LocalAnalyzeResponseSchema.safeParse({ ...response, aiEnhancement: { schemaVersion: '1.0' } })
        .success,
    ).toBe(false);
  });
});

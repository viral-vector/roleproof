import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  LocalAnalyzeRequestSchema,
  LocalAnalyzeResponseSchema,
  LocalHistoryListResponseSchema,
  LocalHistoryQuerySchema,
  LocalResumeParseErrorSchema,
  LocalResumeParseResponseSchema,
  LocalResumeUploadMetadataSchema,
  LocalSettingsPatchSchema,
  LocalSettingsResponseSchema,
  LocalSettingsSchema,
  type LocalAnalyzeRequest,
  type LocalAnalyzeResponse,
  type LocalHistoryListResponse,
  type LocalResumeParseError,
  type LocalSettings,
  type LocalSettingsPatch,
  type LocalSettingsResponse,
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

  it('validates bounded local resume upload metadata and parse responses', () => {
    expect(
      LocalResumeUploadMetadataSchema.parse({
        fileName: 'fictional resume.pdf',
        format: 'pdf',
        byteLength: 4096,
      }),
    ).toEqual({ fileName: 'fictional resume.pdf', format: 'pdf', byteLength: 4096 });
    expect(
      LocalResumeUploadMetadataSchema.safeParse({
        fileName: '../private.pdf',
        format: 'pdf',
        byteLength: 4096,
      }).success,
    ).toBe(false);
    expect(
      LocalResumeUploadMetadataSchema.safeParse({
        fileName: 'fictional resume.txt',
        format: 'plaintext',
        byteLength: 1_000_001,
      }).success,
    ).toBe(false);
    expect(
      LocalResumeUploadMetadataSchema.parse({
        fileName: 'fictional resume.docx',
        format: 'docx',
        byteLength: 4096,
      }),
    ).toEqual({ fileName: 'fictional resume.docx', format: 'docx', byteLength: 4096 });
    expect(
      LocalResumeUploadMetadataSchema.safeParse({
        fileName: 'fictional resume.docx',
        format: 'docx',
        byteLength: 10_000_001,
      }).success,
    ).toBe(false);
    expect(
      LocalResumeUploadMetadataSchema.safeParse({
        fileName: 'fictional resume.txt',
        format: 'docx',
        byteLength: 4096,
      }).success,
    ).toBe(false);
    expect(
      LocalResumeParseResponseSchema.parse({
        schemaVersion: '1.0',
        text: 'Fictional TypeScript experience.',
        format: 'docx',
        warnings: [],
      }),
    ).toEqual({
      schemaVersion: '1.0',
      text: 'Fictional TypeScript experience.',
      format: 'docx',
      warnings: [],
    });
  });

  it('validates content-free resume parse error bodies with an optional reason code', () => {
    const withCode = LocalResumeParseErrorSchema.parse({
      error: 'Invalid resume file.',
      code: 'docx-error',
    });

    expect(withCode).toEqual({ error: 'Invalid resume file.', code: 'docx-error' });
    expectTypeOf(withCode).toEqualTypeOf<LocalResumeParseError>();
    expect(LocalResumeParseErrorSchema.parse({ error: 'Invalid resume file.' })).toEqual({
      error: 'Invalid resume file.',
    });
    expect(
      LocalResumeParseErrorSchema.safeParse({ error: 'Invalid resume file.', code: 'made-up' })
        .success,
    ).toBe(false);
    expect(
      LocalResumeParseErrorSchema.safeParse({
        error: 'Invalid resume file.',
        code: 'docx-error',
        text: 'PRIVATE CONTENT',
      }).success,
    ).toBe(false);
    for (const code of [
      'binary-content',
      'docx-error',
      'empty-document',
      'pdf-error',
      'pdf-page-limit',
      'pdf-timeout',
      'size-limit',
    ]) {
      expect(
        LocalResumeParseErrorSchema.safeParse({ error: 'Invalid resume file.', code }).success,
      ).toBe(true);
    }
  });

  it('validates local history list responses using the canonical history item', () => {
    const response = {
      schemaVersion: '1.0',
      history: [
        {
          schemaVersion: '1.0',
          id: 'analysis-history-item-1',
          jobId: 'job-history-item-1',
          overallScore: 72,
          recommendation: 'stretch',
          confidence: 0.8,
          hasHardBlocker: false,
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    } as const;

    const parsed = LocalHistoryListResponseSchema.parse(response);

    expect(parsed).toEqual(response);
    expectTypeOf(parsed).toEqualTypeOf<LocalHistoryListResponse>();
    expect(LocalHistoryListResponseSchema.parse({ schemaVersion: '1.0', history: [] })).toEqual({
      schemaVersion: '1.0',
      history: [],
    });
    expect(
      LocalHistoryListResponseSchema.safeParse({
        schemaVersion: '1.0',
        history: [{ ...response.history[0], recommendation: 'maybe' }],
      }).success,
    ).toBe(false);
    expect(
      LocalHistoryListResponseSchema.safeParse({
        schemaVersion: '1.0',
        history: [response.history[0]],
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('validates bounded local history search queries', () => {
    expect(LocalHistoryQuerySchema.parse({ query: 'TypeScript' })).toEqual({ query: 'TypeScript' });
    expect(LocalHistoryQuerySchema.parse({ query: '' })).toEqual({ query: '' });
    expect(LocalHistoryQuerySchema.safeParse({ query: 'x'.repeat(501) }).success).toBe(false);
    expect(LocalHistoryQuerySchema.parse({})).toEqual({});
  });

  it('validates optional local settings with provider-consistency rules', () => {
    const settings = {
      provider: 'openai-compatible',
      model: 'fictional-model',
      destination: 'local',
      baseUrl: 'http://localhost:11434/v1',
      redactEmployer: true,
      redactClearance: false,
      redactionTerms: ['fictional-client'],
      defaultExportFormat: 'json',
      maxTotalTokens: 4096,
      maxCostUsd: 0.5,
      providerTimeoutMs: 60_000,
    } as const;

    const parsed = LocalSettingsSchema.parse(settings);

    expect(parsed).toEqual(settings);
    expectTypeOf(parsed).toEqualTypeOf<LocalSettings>();
    expect(LocalSettingsSchema.parse({})).toEqual({});
    expect(
      LocalSettingsSchema.safeParse({ provider: 'openai', model: 'fictional-model' }).success,
    ).toBe(true);
    expect(
      LocalSettingsSchema.safeParse({ provider: 'openai-compatible', model: 'fictional-model' })
        .success,
    ).toBe(false);
    expect(LocalSettingsSchema.safeParse({ provider: 'openai' }).success).toBe(false);
    expect(LocalSettingsSchema.safeParse({ provider: 'openai', model: null }).success).toBe(false);
    expect(
      LocalSettingsSchema.safeParse({ provider: 'openai-compatible', baseUrl: null }).success,
    ).toBe(false);
    expect(LocalSettingsSchema.safeParse({ provider: null, model: null }).success).toBe(true);
    expect(LocalSettingsSchema.safeParse({ provider: null }).success).toBe(true);
    expect(LocalSettingsSchema.safeParse({ baseUrl: null }).success).toBe(true);
    expect(LocalSettingsSchema.safeParse({ defaultExportFormat: null }).success).toBe(true);
    expect(LocalSettingsSchema.safeParse({ maxTotalTokens: null }).success).toBe(true);
    expect(LocalSettingsSchema.safeParse({ maxCostUsd: null }).success).toBe(true);
    expect(LocalSettingsSchema.safeParse({ providerTimeoutMs: null }).success).toBe(true);
    expect(LocalSettingsSchema.safeParse({ provider: 'unexpected-provider' }).success).toBe(false);
    expect(LocalSettingsSchema.safeParse({ maxTotalTokens: 0 }).success).toBe(false);
    expect(LocalSettingsSchema.safeParse({ maxCostUsd: Number.NaN }).success).toBe(false);
    expect(LocalSettingsSchema.safeParse({ providerTimeoutMs: 500 }).success).toBe(false);
    expect(LocalSettingsSchema.safeParse({ redactionTerms: ['   '] }).success).toBe(false);
    expect(
      LocalSettingsSchema.safeParse({
        redactionTerms: Array.from({ length: 51 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false);
    expect(LocalSettingsSchema.safeParse({ unknownSetting: true }).success).toBe(false);
  });

  it('validates local settings patches before merge without provider-consistency rules', () => {
    const patch = LocalSettingsPatchSchema.parse({
      provider: 'openai-compatible',
      defaultExportFormat: null,
      maxTotalTokens: null,
    });

    expect(patch).toEqual({
      provider: 'openai-compatible',
      defaultExportFormat: null,
      maxTotalTokens: null,
    });
    expectTypeOf(patch).toEqualTypeOf<LocalSettingsPatch>();
    expect(LocalSettingsPatchSchema.safeParse({ provider: 'openai-compatible' }).success).toBe(
      true,
    );
    expect(LocalSettingsPatchSchema.safeParse({ provider: 'openai' }).success).toBe(true);
    expect(LocalSettingsSchema.safeParse({ provider: 'openai-compatible' }).success).toBe(false);
    expect(LocalSettingsPatchSchema.safeParse({ provider: 'unexpected-provider' }).success).toBe(
      false,
    );
  });

  it('validates local settings responses with the resolved database path', () => {
    const response = {
      schemaVersion: '1.0',
      settings: { provider: 'openai', model: 'fictional-model' },
      databasePath: 'C:\\Users\\fictional\\.roleproof\\roleproof.db',
    } as const;

    const parsed = LocalSettingsResponseSchema.parse(response);

    expect(parsed).toEqual(response);
    expectTypeOf(parsed).toEqualTypeOf<LocalSettingsResponse>();
    expect(
      LocalSettingsResponseSchema.parse({ schemaVersion: '1.0', settings: {}, databasePath: 'x' }),
    ).toEqual({
      schemaVersion: '1.0',
      settings: {},
      databasePath: 'x',
    });
    expect(
      LocalSettingsResponseSchema.safeParse({
        schemaVersion: '1.0',
        settings: { provider: 'openai-compatible' },
        databasePath: 'x',
      }).success,
    ).toBe(false);
    expect(
      LocalSettingsResponseSchema.safeParse({ schemaVersion: '1.0', settings: {} }).success,
    ).toBe(false);
  });
});

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  LocalAnalyzeRequestSchema,
  LocalAnalyzeResponseSchema,
  LocalResumeParseErrorSchema,
  LocalResumeParseResponseSchema,
  LocalResumeUploadMetadataSchema,
  type LocalAnalyzeRequest,
  type LocalAnalyzeResponse,
  type LocalResumeParseError,
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
});

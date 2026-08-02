import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AtsProviderSchema,
  JobRetrievalMetadataSchema,
  JobSourceClassificationSchema,
  JobUrlConfigSchema,
  LocalJobUrlSchema,
  StoredJobSourceSchema,
  type JobRetrievalMetadata,
  type StoredJobSource,
} from '../src/index.js';

describe('Phase 5 job URL source schemas', () => {
  it('classifies job sources with the documented source types', () => {
    for (const value of [
      'official-employer',
      'official-ats',
      'recruiter',
      'aggregator',
      'unknown',
      'removed-unavailable',
    ]) {
      expect(JobSourceClassificationSchema.parse(value)).toBe(value);
    }
    expect(JobSourceClassificationSchema.safeParse('ghost-job').success).toBe(false);
  });

  it('enumerates recognized ATS providers', () => {
    for (const value of [
      'greenhouse',
      'lever',
      'workday',
      'ashby',
      'paylocity',
      'rippling',
      'jazzhr',
      'smartrecruiters',
      'unknown',
    ]) {
      expect(AtsProviderSchema.parse(value)).toBe(value);
    }
    expect(AtsProviderSchema.safeParse('nonexistent-ats').success).toBe(false);
  });

  it('validates job retrieval metadata for an official ATS page', () => {
    const metadata = {
      schemaVersion: '1.0',
      url: 'https://boards.greenhouse.io/fictionalco/jobs/123',
      finalUrl: 'https://boards.greenhouse.io/fictionalco/jobs/123',
      retrievedAt: '2026-08-02T10:00:00.000Z',
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
      sourceClassification: 'official-ats',
      atsProvider: 'greenhouse',
      removedOrUnavailable: false,
      confidence: 0.9,
      warnings: [],
    } as const;

    const parsed = JobRetrievalMetadataSchema.parse(metadata);

    expect(parsed).toEqual(metadata);
    expectTypeOf(parsed).toEqualTypeOf<JobRetrievalMetadata>();
  });

  it('captures removed or unavailable pages without fabrication', () => {
    const parsed = JobRetrievalMetadataSchema.parse({
      schemaVersion: '1.0',
      url: 'https://boards.greenhouse.io/fictionalco/jobs/404',
      retrievedAt: '2026-08-02T10:00:00.000Z',
      statusCode: 404,
      sourceClassification: 'removed-unavailable',
      atsProvider: 'unknown',
      removedOrUnavailable: true,
      confidence: 0.9,
      warnings: [
        { code: 'removed-page', message: 'Page indicates the posting is no longer available.' },
      ],
    });

    expect(parsed.removedOrUnavailable).toBe(true);
    expect(parsed.sourceClassification).toBe('removed-unavailable');
    expect(parsed.warnings[0]?.code).toBe('removed-page');
  });

  it('validates aggregator and unknown source pages without a confirmed ATS provider', () => {
    for (const sourceClassification of ['aggregator', 'unknown'] as const) {
      expect(
        JobRetrievalMetadataSchema.parse({
          schemaVersion: '1.0',
          url: `https://example.com/${sourceClassification}-job`,
          retrievedAt: '2026-08-02T10:00:00.000Z',
          sourceClassification,
          atsProvider: 'unknown',
          removedOrUnavailable: false,
          confidence: 0.5,
          warnings: [],
        }).atsProvider,
      ).toBe('unknown');
    }
  });

  it('requires a known ATS provider for official-ats pages', () => {
    expect(
      JobRetrievalMetadataSchema.safeParse({
        schemaVersion: '1.0',
        url: 'https://boards.greenhouse.io/fictionalco/jobs/123',
        retrievedAt: '2026-08-02T10:00:00.000Z',
        sourceClassification: 'official-ats',
        atsProvider: 'unknown',
        removedOrUnavailable: false,
        confidence: 0.9,
        warnings: [],
      }).success,
    ).toBe(false);
  });

  it('keeps removal flags consistent with the source classification', () => {
    expect(
      JobRetrievalMetadataSchema.safeParse({
        schemaVersion: '1.0',
        url: 'https://example.com/job',
        retrievedAt: '2026-08-02T10:00:00.000Z',
        sourceClassification: 'removed-unavailable',
        atsProvider: 'unknown',
        removedOrUnavailable: false,
        confidence: 0.9,
        warnings: [],
      }).success,
    ).toBe(false);
    expect(
      JobRetrievalMetadataSchema.safeParse({
        schemaVersion: '1.0',
        url: 'https://example.com/job',
        retrievedAt: '2026-08-02T10:00:00.000Z',
        sourceClassification: 'unknown',
        atsProvider: 'unknown',
        removedOrUnavailable: true,
        confidence: 0.9,
        warnings: [],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown warning codes', () => {
    expect(
      JobRetrievalMetadataSchema.safeParse({
        schemaVersion: '1.0',
        url: 'https://example.com/job',
        retrievedAt: '2026-08-02T10:00:00.000Z',
        sourceClassification: 'unknown',
        atsProvider: 'unknown',
        removedOrUnavailable: false,
        confidence: 0.5,
        warnings: [{ code: 'unknown-warning', message: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('rejects strict metadata with an unknown field', () => {
    expect(
      JobRetrievalMetadataSchema.safeParse({
        schemaVersion: '1.0',
        url: 'https://example.com/job',
        retrievedAt: '2026-08-02T10:00:00.000Z',
        sourceClassification: 'unknown',
        atsProvider: 'unknown',
        removedOrUnavailable: false,
        confidence: 0.5,
        warnings: [],
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('validates bounded local job URLs', () => {
    expect(
      LocalJobUrlSchema.safeParse('https://boards.greenhouse.io/fictionalco/jobs/123').success,
    ).toBe(true);
    expect(LocalJobUrlSchema.safeParse('ftp://example.com/job').success).toBe(false);
    expect(LocalJobUrlSchema.safeParse('not-a-url').success).toBe(false);
    expect(LocalJobUrlSchema.safeParse('https://example.com/job#fragment').success).toBe(true);
  });

  it('validates job URL fetch configuration limits', () => {
    expect(
      JobUrlConfigSchema.parse({ maxFetchBytes: 5_000_000, timeoutMs: 10_000, maxRedirects: 5 }),
    ).toEqual({ maxFetchBytes: 5_000_000, timeoutMs: 10_000, maxRedirects: 5 });
    expect(
      JobUrlConfigSchema.safeParse({ maxFetchBytes: 0, timeoutMs: 1, maxRedirects: 0 }).success,
    ).toBe(false);
    expect(
      JobUrlConfigSchema.safeParse({ maxFetchBytes: 1, timeoutMs: 0, maxRedirects: 1 }).success,
    ).toBe(false);
  });

  it('validates stored job source rows for persistence', () => {
    const stored = {
      jobId: 'job-abcdef',
      schemaVersion: '1.0',
      url: 'https://boards.greenhouse.io/fictionalco/jobs/123',
      finalUrl: 'https://boards.greenhouse.io/fictionalco/jobs/123',
      retrievedAt: '2026-08-02T10:00:00.000Z',
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
      sourceClassification: 'official-ats',
      atsProvider: 'greenhouse',
      removedOrUnavailable: false,
      confidence: 0.9,
      warnings: [],
      createdAt: '2026-08-02T10:00:01.000Z',
      updatedAt: '2026-08-02T10:00:01.000Z',
    } as const;

    const parsed = StoredJobSourceSchema.parse(stored);

    expect(parsed.jobId).toBe('job-abcdef');
    expectTypeOf(parsed).toEqualTypeOf<StoredJobSource>();
    expect(StoredJobSourceSchema.safeParse({ ...stored, jobId: '' }).success).toBe(false);
  });
});

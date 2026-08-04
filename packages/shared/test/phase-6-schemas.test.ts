import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AnalysisResultSchema,
  BatchConfigSchema,
  BatchEnvelopeSchema,
  BatchManifestSchema,
  DEFAULT_BATCH_CONFIG,
  type BatchEnvelope,
  type BatchManifest,
} from '../src/index.js';

const analysis = AnalysisResultSchema.parse({
  schemaVersion: '1.0',
  id: 'analysis-batch',
  overallScore: 88,
  recommendation: 'apply',
  confidence: 1,
  hardBlockers: [],
  matchedRequirements: [
    {
      requirementId: 'requirement-typescript',
      evidenceIds: ['evidence-typescript'],
      classification: 'direct',
      score: 1,
      explanation: 'The fictional resume explicitly supports TypeScript.',
    },
  ],
  missingRequirements: [],
  unsupportedClaims: [],
  suggestedEmphasis: [],
  suggestedAdditions: [],
  interviewTopics: ['TypeScript'],
  generatedAt: '2026-08-04T00:00:00.000Z',
  metadata: {
    mode: 'deterministic',
    engineVersion: '0.6.0',
    normalizationVersion: '1.0.0',
    scoringVersion: '1.0.0',
    parsing: { resumeConfidence: 1, jobConfidence: 1, warnings: [] },
  },
  scoreContributions: [],
  resumeDocumentId: 'document-resume',
  jobId: 'job-backend',
});

const validManifest: BatchManifest = {
  schemaVersion: '1.0',
  pairs: [
    { resume: 'resumes/avery.txt', job: 'jobs/backend.txt' },
    { resume: 'resumes/blake.pdf', job: 'jobs/frontend.txt' },
  ],
};

describe('BatchManifestSchema', () => {
  it('accepts a valid manifest with multiple pairs', () => {
    expect(BatchManifestSchema.parse(validManifest)).toEqual(validManifest);
  });

  it('rejects a blank resume path', () => {
    const result = BatchManifestSchema.safeParse({
      schemaVersion: '1.0',
      pairs: [{ resume: '   ', job: 'jobs/backend.txt' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'pairs.0.resume')).toBe(
        true,
      );
    }
  });

  it('rejects an empty pairs array', () => {
    expect(BatchManifestSchema.safeParse({ schemaVersion: '1.0', pairs: [] }).success).toBe(false);
  });

  it('rejects an unknown schemaVersion', () => {
    expect(
      BatchManifestSchema.safeParse({ schemaVersion: '2.0', pairs: validManifest.pairs }).success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(BatchManifestSchema.safeParse({ ...validManifest, extra: true }).success).toBe(false);
  });

  it('rejects non-string paths', () => {
    expect(
      BatchManifestSchema.safeParse({
        schemaVersion: '1.0',
        pairs: [{ resume: 42, job: 'jobs/backend.txt' }],
      }).success,
    ).toBe(false);
  });

  it('infers the BatchManifest type from the schema', () => {
    expectTypeOf<BatchManifest>().toMatchTypeOf<ReturnType<typeof BatchManifestSchema.parse>>();
  });
});

describe('BatchConfigSchema', () => {
  it('provides parsed defaults within the documented range', () => {
    expect(DEFAULT_BATCH_CONFIG.maxPairs).toBeGreaterThan(0);
    expect(DEFAULT_BATCH_CONFIG.defaultConcurrency).toBeGreaterThan(0);
    expect(DEFAULT_BATCH_CONFIG.defaultConcurrency).toBeLessThanOrEqual(
      DEFAULT_BATCH_CONFIG.maxConcurrency,
    );
  });

  it('rejects a default concurrency above the maximum', () => {
    expect(
      BatchConfigSchema.safeParse({
        maxConcurrency: 2,
        defaultConcurrency: 3,
        maxPairs: 10,
      }).success,
    ).toBe(false);
  });

  it('rejects a non-integer maximum', () => {
    expect(
      BatchConfigSchema.safeParse({
        maxConcurrency: 2.5,
        defaultConcurrency: 1,
        maxPairs: 10,
      }).success,
    ).toBe(false);
  });
});

describe('BatchEnvelopeSchema', () => {
  it('accepts completed and failed pair results', () => {
    const envelope: BatchEnvelope = {
      schemaVersion: '1.0',
      pairs: [
        {
          status: 'completed',
          resumeDocumentId: 'document-resume',
          jobId: 'job-backend',
          analysis,
        },
        { status: 'failed', code: 3, error: 'Resume file could not be parsed.' },
      ],
    };
    expect(BatchEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it('rejects a completed result without an analysis', () => {
    expect(
      BatchEnvelopeSchema.safeParse({
        schemaVersion: '1.0',
        pairs: [{ status: 'completed', resumeDocumentId: 'document-resume', jobId: 'job-backend' }],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown pair status', () => {
    expect(
      BatchEnvelopeSchema.safeParse({
        schemaVersion: '1.0',
        pairs: [{ status: 'skipped', error: 'nope' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a failed result without an error message', () => {
    expect(
      BatchEnvelopeSchema.safeParse({
        schemaVersion: '1.0',
        pairs: [{ status: 'failed', code: 3 }],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown envelope keys', () => {
    expect(
      BatchEnvelopeSchema.safeParse({
        schemaVersion: '1.0',
        pairs: [{ status: 'failed', code: 3, error: 'boom' }],
        summary: 'x',
      }).success,
    ).toBe(false);
  });

  it('infers the BatchEnvelope type from the schema', () => {
    expectTypeOf<BatchEnvelope>().toMatchTypeOf<ReturnType<typeof BatchEnvelopeSchema.parse>>();
  });
});

import { describe, expect, it } from 'vitest';

import { AnalysisResultSchema, BatchEnvelopeSchema, type BatchEnvelope } from '@roleproof/shared';

import { renderBatchJson, renderBatchMarkdown } from '../src/index.js';

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

const envelope: BatchEnvelope = {
  schemaVersion: '1.0',
  pairs: [
    { status: 'completed', resumeDocumentId: 'document-resume', jobId: 'job-backend', analysis },
    { status: 'failed', code: 3, error: 'Resume file could not be parsed.' },
  ],
};

describe('renderBatchMarkdown', () => {
  it('renders the envelope schema version and per-pair outcomes in order', () => {
    const markdown = renderBatchMarkdown(envelope);
    expect(markdown).toContain('RoleProof Batch Analysis');
    expect(markdown).toContain('Schema version: 1.0');
    expect(markdown).toContain('Pair 1');
    expect(markdown).toContain('Recommendation: **apply**');
    expect(markdown).toContain('Pair 2');
    expect(markdown).toContain('Status: **failed** (exit code 3)');
    expect(markdown).toContain('Resume file could not be parsed.');
    expect(markdown.indexOf('Pair 1')).toBeLessThan(markdown.indexOf('Pair 2'));
  });

  it('renders blockers when present', () => {
    const blocked = renderBatchMarkdown({
      ...envelope,
      pairs: [
        {
          status: 'completed',
          resumeDocumentId: 'document-resume',
          jobId: 'job-backend',
          analysis: { ...analysis, hardBlockers: ['Work authorization is required.'] },
        },
      ],
    });
    expect(blocked).toContain('**Blocker:** Work authorization is required.');
  });

  it('produces stable output for identical envelopes', () => {
    expect(renderBatchMarkdown(envelope)).toBe(renderBatchMarkdown(envelope));
  });
});

describe('renderBatchJson', () => {
  it('serializes the validated envelope as pretty JSON', () => {
    const json = renderBatchJson(envelope);
    expect(JSON.parse(json)).toEqual(BatchEnvelopeSchema.parse(envelope));
    expect(json).toContain('"schemaVersion": "1.0"');
  });
});

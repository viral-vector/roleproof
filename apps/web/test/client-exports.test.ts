import { describe, expect, it } from 'vitest';
import { AnalysisEnvelopeSchema, AnalysisResultSchema } from '@roleproof/shared';

import { createAnalysisDownload } from '../src/client/exports/download.js';

const analysis = AnalysisResultSchema.parse({
  schemaVersion: '1.0',
  id: 'analysis-private-id',
  overallScore: 72,
  recommendation: 'apply',
  confidence: 0.8,
  hardBlockers: [],
  matchedRequirements: [],
  missingRequirements: [],
  unsupportedClaims: [],
  suggestedEmphasis: [],
  suggestedAdditions: [],
  interviewTopics: [],
  generatedAt: '2026-01-01T00:00:00.000Z',
  metadata: { mode: 'deterministic', engineVersion: '0.3.0' },
});

describe('local analysis downloads', () => {
  it('creates a schema-valid JSON download with a content-free filename', () => {
    const download = createAnalysisDownload(analysis, 'json');

    expect(download.filename).toBe('roleproof-analysis.json');
    expect(download.mimeType).toBe('application/json;charset=utf-8');
    expect(download.filename).not.toContain(analysis.id);
    expect(AnalysisEnvelopeSchema.parse(JSON.parse(download.content)).analysis).toEqual(analysis);
  });

  it('creates the canonical Markdown report with a content-free filename', () => {
    const download = createAnalysisDownload(analysis, 'markdown');

    expect(download.filename).toBe('roleproof-analysis.md');
    expect(download.mimeType).toBe('text/markdown;charset=utf-8');
    expect(download.filename).not.toContain(analysis.id);
    expect(download.content).toContain('# RoleProof Analysis');
    expect(download.content).toContain('## Safe Résumé Emphasis');
  });
});

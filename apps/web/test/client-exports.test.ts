import { describe, expect, it } from 'vitest';
import {
  AnalysisEnvelopeSchema,
  AnalysisResultSchema,
  EnhancedAnalysisEnvelopeSchema,
} from '@roleproof/shared';

import { createAnalysisDownload } from '../src/client/exports/download.js';
import { renderEnhancedMarkdown } from '@roleproof/reporters';

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

  it('creates an enhanced markdown report with a dedicated AI section', () => {
    const enhancement = EnhancedAnalysisEnvelopeSchema.parse({
      schemaVersion: '2.0',
      analysis,
      aiEnhancement: {
        schemaVersion: '1.0',
        baselineAnalysisId: analysis.id,
        requirementAnalysis: { requirements: [] },
        evidenceMapping: { mappings: [] },
        applicationSuggestions: {
          suggestedEmphasis: [],
          suggestedAdditions: [],
          interviewTopics: [],
          coverLetterAngles: [],
        },
        providerExecutions: [
          {
            operation: 'analyze-requirements',
            provider: 'openai',
            model: 'fictional-model',
            destination: 'hosted',
            manifest: {
              provider: 'openai',
              model: 'fictional-model',
              destination: 'hosted',
              endpointOrigin: 'https://api.openai.com',
              dataCategories: [],
              redactionApplied: true,
              redactionSummary: {
                categories: [],
                replacementCount: 0,
                inputChars: 0,
                outputChars: 0,
              },
            },
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costMicroUsd: 1 },
            requestId: 'request-1',
            errorCode: null,
          },
          {
            operation: 'map-evidence',
            provider: 'openai',
            model: 'fictional-model',
            destination: 'hosted',
            manifest: {
              provider: 'openai',
              model: 'fictional-model',
              destination: 'hosted',
              endpointOrigin: 'https://api.openai.com',
              dataCategories: [],
              redactionApplied: true,
              redactionSummary: {
                categories: [],
                replacementCount: 0,
                inputChars: 0,
                outputChars: 0,
              },
            },
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costMicroUsd: 1 },
            requestId: 'request-2',
            errorCode: null,
          },
          {
            operation: 'suggest-application-changes',
            provider: 'openai',
            model: 'fictional-model',
            destination: 'hosted',
            manifest: {
              provider: 'openai',
              model: 'fictional-model',
              destination: 'hosted',
              endpointOrigin: 'https://api.openai.com',
              dataCategories: [],
              redactionApplied: true,
              redactionSummary: {
                categories: [],
                replacementCount: 0,
                inputChars: 0,
                outputChars: 0,
              },
            },
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costMicroUsd: 1 },
            requestId: 'request-3',
            errorCode: null,
          },
        ],
      },
    });

    const markdown = renderEnhancedMarkdown(enhancement.analysis, enhancement.aiEnhancement);
    expect(markdown).toContain('## AI Requirement Interpretations');
    expect(markdown).toContain('## Provider Metadata');
  });
});

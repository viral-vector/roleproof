import { describe, expect, it } from 'vitest';

import {
  AIEnhancementSchema,
  AnalysisResultSchema,
  EnhancedAnalysisEnvelopeSchema,
  type AIEnhancement,
  type AnalysisResult,
} from '@roleproof/shared';

import {
  renderEnhancedJson,
  renderEnhancedMarkdown,
  renderJson,
  renderMarkdown,
} from '../src/index.js';

const analysis: AnalysisResult = AnalysisResultSchema.parse({
  schemaVersion: '1.0',
  id: 'analysis-reporter',
  overallScore: 68,
  recommendation: 'stretch',
  confidence: 0.9,
  hardBlockers: ['Work authorization is required.'],
  matchedRequirements: [
    {
      requirementId: 'requirement-typescript',
      evidenceIds: ['evidence-typescript'],
      classification: 'direct',
      score: 1,
      explanation: 'The fictional resume explicitly supports TypeScript.',
    },
    {
      requirementId: 'requirement-kubernetes',
      evidenceIds: ['evidence-docker'],
      classification: 'partially-related',
      score: 0.4,
      explanation: 'Docker is related but is not direct Kubernetes experience.',
    },
    {
      requirementId: 'requirement-graphql',
      evidenceIds: [],
      classification: 'unsupported',
      score: 0,
      explanation: 'No supplied evidence supports GraphQL.',
    },
  ],
  missingRequirements: [
    {
      id: 'requirement-graphql',
      category: 'other',
      text: 'GraphQL is required.',
      normalizedName: 'GraphQL',
      importance: 'required',
    },
  ],
  unsupportedClaims: [
    {
      text: 'Do not claim direct GraphQL experience.',
      classification: 'unsupported',
      evidenceIds: [],
      explanation: 'No supplied evidence supports GraphQL.',
    },
  ],
  suggestedEmphasis: [
    {
      text: 'Emphasize the cited TypeScript evidence.',
      classification: 'direct',
      evidenceIds: ['evidence-typescript'],
      explanation: 'The evidence is explicit.',
    },
  ],
  suggestedAdditions: [
    {
      text: 'Confirm Kubernetes production use before adding it.',
      classification: 'requires-user-confirmation',
      evidenceIds: [],
      explanation: 'Only related Docker evidence exists.',
    },
  ],
  interviewTopics: ['TypeScript', 'Docker versus Kubernetes'],
  generatedAt: '2026-01-01T00:00:00.000Z',
  metadata: {
    mode: 'deterministic',
    engineVersion: '0.1.0',
    normalizationVersion: '1.0.0',
    scoringVersion: '1.0.0',
    parsing: {
      resumeConfidence: 1,
      jobConfidence: 0.9,
      warnings: [],
    },
  },
  scoreContributions: [
    {
      requirementId: 'requirement-typescript',
      scoringCategory: 'required-technical',
      classification: 'direct',
      evidenceIds: ['evidence-typescript'],
      appliedWeight: 50,
      pointsAwarded: 50,
      explanation: '50 of 50 points.',
    },
    {
      requirementId: 'requirement-kubernetes',
      scoringCategory: 'infrastructure-delivery',
      classification: 'partially-related',
      evidenceIds: ['evidence-docker'],
      appliedWeight: 45,
      pointsAwarded: 18,
      explanation: '18 of 45 points.',
    },
    {
      requirementId: 'requirement-graphql',
      scoringCategory: 'responsibilities',
      classification: 'unsupported',
      evidenceIds: [],
      appliedWeight: 5,
      pointsAwarded: 0,
      explanation: '0 of 5 points.',
    },
  ],
});

const enhancement: AIEnhancement = AIEnhancementSchema.parse({
  schemaVersion: '1.0',
  baselineAnalysisId: analysis.id,
  requirementAnalysis: {
    requirements: [
      {
        requirementId: 'requirement-kubernetes',
        baselineClassification: 'partially-related',
        classification: 'partially-related',
        evidenceIds: ['evidence-docker'],
        explanation: 'Docker is adjacent evidence, not direct Kubernetes evidence.',
      },
    ],
  },
  evidenceMapping: {
    mappings: [
      {
        requirementId: 'requirement-kubernetes',
        baselineClassification: 'partially-related',
        classification: 'partially-related',
        evidenceIds: ['evidence-docker'],
        explanation: 'The cited evidence supports only a partial mapping.',
      },
    ],
  },
  applicationSuggestions: {
    suggestedEmphasis: [
      {
        text: 'Emphasize container delivery.',
        classification: 'partially-related',
        evidenceIds: ['evidence-docker'],
        explanation: 'This stays within the cited evidence.',
      },
    ],
    suggestedAdditions: [
      {
        text: 'Confirm Kubernetes use before adding it.',
        classification: 'requires-user-confirmation',
        evidenceIds: [],
        explanation: 'No direct evidence was supplied.',
      },
    ],
    interviewTopics: [
      {
        topic: 'Container delivery boundaries',
        evidenceIds: ['evidence-docker'],
        rationale: 'Discuss only the evidenced Docker work.',
      },
    ],
    coverLetterAngles: [
      { text: 'Connect container delivery to the role.', evidenceIds: ['evidence-docker'] },
    ],
  },
  providerExecutions: [
    {
      operation: 'analyze-requirements',
      provider: 'openai',
      model: 'gpt-fictional',
      destination: 'hosted',
      manifest: {
        provider: 'openai',
        model: 'gpt-fictional',
        destination: 'hosted',
        endpointOrigin: 'https://api.openai.com',
        dataCategories: ['job-summary', 'requirement-text'],
        redactionApplied: true,
        redactionSummary: {
          categories: ['email'],
          replacementCount: 1,
          inputChars: 120,
          outputChars: 110,
        },
      },
      usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40, costMicroUsd: 2 },
      errorCode: null,
    },
  ],
});

describe('renderJson', () => {
  it('renders exactly one schema-valid JSON envelope with a trailing newline', () => {
    const rendered = renderJson(analysis);
    const parsed = JSON.parse(rendered) as { analysis: AnalysisResult; schemaVersion: string };

    expect(rendered.endsWith('\n')).toBe(true);
    expect(parsed.schemaVersion).toBe('1.0');
    expect(parsed.analysis).toEqual(analysis);
    expect(rendered.trimStart().startsWith('{')).toBe(true);
  });

  it('rejects invalid analysis instead of repairing it', () => {
    expect(() => renderJson({ ...analysis, overallScore: 101 })).toThrow();
  });
});

describe('renderMarkdown', () => {
  it('renders every required section without recalculating the result', () => {
    const rendered = renderMarkdown(analysis);

    for (const heading of [
      '# RoleProof Analysis',
      '## Role',
      '## Recommendation',
      '## Eligibility',
      '## Overall Fit',
      '## Strong Matches',
      '## Partial Matches',
      '## Missing Requirements',
      '## Unsupported or Risky Claims',
      '## Safe Résumé Emphasis',
      '## Suggested Additions Requiring Confirmation',
      '## Interview Talking Points',
      '## Analysis Metadata',
    ]) {
      expect(rendered).toContain(heading);
    }
    expect(rendered).toContain('Recommendation: **stretch**');
    expect(rendered).toContain('Overall score: **68/100**');
    expect(rendered).toContain('evidence-typescript');
    expect(rendered).toContain('not direct Kubernetes experience');
    expect(rendered).not.toMatch(/interview probability|hiring probability/i);
  });
});

describe('enhanced reporters', () => {
  it('leaves legacy reporter output exactly unchanged', () => {
    const jsonBefore = renderJson(analysis);
    const markdownBefore = renderMarkdown(analysis);

    renderEnhancedJson(analysis, enhancement);
    renderEnhancedMarkdown(analysis, enhancement);

    expect(renderJson(analysis)).toBe(jsonBefore);
    expect(renderMarkdown(analysis)).toBe(markdownBefore);
  });

  it('renders only a strict enhanced JSON envelope with a trailing newline', () => {
    const rendered = renderEnhancedJson(analysis, enhancement);
    const parsed: unknown = JSON.parse(rendered);

    expect(rendered.endsWith('\n')).toBe(true);
    expect(EnhancedAnalysisEnvelopeSchema.parse(parsed)).toEqual({
      schemaVersion: '2.0',
      analysis,
      aiEnhancement: enhancement,
    });
    expect(rendered).not.toContain('```');
  });

  it('rejects a mismatched baseline ID', () => {
    expect(() =>
      renderEnhancedJson(analysis, { ...enhancement, baselineAnalysisId: 'analysis-other' }),
    ).toThrow();
    expect(() =>
      renderEnhancedMarkdown(analysis, { ...enhancement, baselineAnalysisId: 'analysis-other' }),
    ).toThrow();
  });

  it('labels immutable deterministic results and evidence-linked AI sections', () => {
    const rendered = renderEnhancedMarkdown(analysis, enhancement);

    expect(rendered.match(/^# /gmu)).toHaveLength(1);
    expect(rendered).toMatch(/^# RoleProof Analysis$/mu);

    for (const value of [
      'AI Enhancement',
      'AI Requirement Interpretations',
      'AI Evidence Mappings',
      'AI Suggested Emphasis',
      'AI Suggested Additions',
      'AI Interview Topics',
      'AI Cover-Letter Angles',
      'Provider Metadata',
      'evidence-docker',
      'gpt-fictional',
      'hosted',
      'Redaction applied: **yes**',
      'Work authorization is required.',
      'The deterministic score, recommendation, and blockers are unchanged by AI enhancement.',
      'AI enhancement does not predict interviews, hiring, or other employment outcomes.',
    ]) {
      expect(rendered).toContain(value);
    }
    expect(rendered).toContain('Overall score: **68/100**');
    expect(rendered.match(/Overall score:/gu)).toHaveLength(1);
    expect(rendered).not.toContain('Recommendation: **apply**');
  });
});

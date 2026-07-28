import { describe, expect, it } from 'vitest';

import { AnalysisResultSchema, type AnalysisResult } from '@roleproof/shared';

import { renderJson, renderMarkdown } from '../src/index.js';

const analysis: AnalysisResult = AnalysisResultSchema.parse({
  schemaVersion: '1.0',
  id: 'analysis-reporter',
  overallScore: 68,
  recommendation: 'stretch',
  confidence: 0.9,
  hardBlockers: [],
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

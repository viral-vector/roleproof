import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type {
  CandidateContext,
  DeterministicAnalysisInput,
  Recommendation,
} from '@roleproof/shared';

import { analyzeDeterministic } from '../src/index.js';

interface Scenario {
  blocker?: string;
  context?: Partial<CandidateContext>;
  expectedRecommendation: Recommendation;
  id: string;
}

const scenarios: Scenario[] = [
  { id: 'strong-match', expectedRecommendation: 'apply' },
  { id: 'stretch-match', expectedRecommendation: 'stretch' },
  { id: 'clear-mismatch', expectedRecommendation: 'skip' },
  {
    id: 'location-blocker',
    expectedRecommendation: 'skip',
    blocker: 'location',
  },
  {
    id: 'sponsorship-blocker',
    expectedRecommendation: 'skip',
    blocker: 'Work authorization',
  },
  {
    id: 'clearance-blocker',
    expectedRecommendation: 'skip',
    blocker: 'clearance',
  },
  { id: 'seniority-mismatch', expectedRecommendation: 'stretch' },
  { id: 'ambiguous-role', expectedRecommendation: 'manual-review' },
  { id: 'adjacent-skills', expectedRecommendation: 'stretch' },
  {
    id: 'missing-salary',
    expectedRecommendation: 'apply',
    context: { targetSalaryMin: 120_000 },
  },
  {
    id: 'compensation-blocker',
    expectedRecommendation: 'skip',
    blocker: 'Compensation maximum',
    context: { targetSalaryMin: 120_000 },
  },
  { id: 'low-confidence-parsing', expectedRecommendation: 'manual-review' },
];

const fixtureRoot = new URL('../../../fixtures/phase-1/', import.meta.url);

async function analyzeScenario(scenario: Scenario) {
  const scenarioRoot = new URL(`${scenario.id}/`, fixtureRoot);
  const [resumeText, jobText] = await Promise.all([
    readFile(new URL('resume.txt', scenarioRoot), 'utf8'),
    readFile(new URL('job.txt', scenarioRoot), 'utf8'),
  ]);
  const candidateContext: CandidateContext = {
    preferredLocations: [],
    clearances: [],
    licenses: [],
    education: [],
    certifications: [],
    ...scenario.context,
  };
  const input: DeterministicAnalysisInput = {
    resume: {
      schemaVersion: '1.0',
      id: `resume-${scenario.id}`,
      kind: 'resume',
      format: 'plaintext',
      text: resumeText.trim(),
      confidence: 1,
      warnings: [],
    },
    job: {
      schemaVersion: '1.0',
      id: `job-${scenario.id}`,
      kind: 'job',
      format: 'plaintext',
      text: jobText.trim(),
      confidence: 1,
      warnings: [],
    },
    candidateContext,
  };
  return analyzeDeterministic(input, { generatedAt: '2026-01-01T00:00:00.000Z' });
}

describe('Phase 1 fictional fixture matrix', () => {
  it.each(scenarios)('$id produces $expectedRecommendation', async (scenario) => {
    const result = await analyzeScenario(scenario);

    expect(result.recommendation).toBe(scenario.expectedRecommendation);
    if (scenario.blocker === undefined) {
      expect(result.hardBlockers).toEqual([]);
    } else {
      expect(result.hardBlockers).toEqual([expect.stringContaining(scenario.blocker)]);
    }
  });

  it('keeps adjacent skills related rather than direct', async () => {
    const result = await analyzeScenario(
      scenarios.find((scenario) => scenario.id === 'adjacent-skills')!,
    );

    expect(result.matchedRequirements.map((match) => match.classification)).toEqual([
      'strongly-related',
      'partially-related',
      'strongly-related',
    ]);
    expect(result.matchedRequirements).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ classification: 'direct' })]),
    );
  });
});

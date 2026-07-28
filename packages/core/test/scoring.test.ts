import { describe, expect, it } from 'vitest';

import type { EvidenceMatch, JobRequirement } from '@roleproof/shared';

import { DEFAULT_SCORING_CONFIG, recommendFromScore, scoreMatches } from '../src/index.js';

const requirements: JobRequirement[] = [
  {
    id: 'technical',
    category: 'language',
    text: 'TypeScript required',
    normalizedName: 'TypeScript',
    importance: 'required',
  },
  {
    id: 'responsibility',
    category: 'other',
    text: 'Backend development required',
    normalizedName: 'Backend development',
    importance: 'required',
  },
  {
    id: 'leadership',
    category: 'leadership',
    text: 'Team leadership required',
    normalizedName: 'Team leadership',
    importance: 'required',
  },
  {
    id: 'domain',
    category: 'domain',
    text: 'Payments domain required',
    normalizedName: 'Payments',
    importance: 'required',
  },
  {
    id: 'infrastructure',
    category: 'infrastructure',
    text: 'Docker required',
    normalizedName: 'Docker',
    importance: 'required',
  },
  {
    id: 'preferred',
    category: 'framework',
    text: 'React preferred',
    normalizedName: 'React',
    importance: 'preferred',
  },
  {
    id: 'eligibility',
    category: 'location',
    text: 'Remote location',
    normalizedName: 'Remote',
    importance: 'required',
  },
];

function match(
  requirementId: string,
  classification: EvidenceMatch['classification'],
): EvidenceMatch {
  const score = {
    direct: 1,
    'strongly-related': 0.75,
    'partially-related': 0.4,
    unsupported: 0,
    unknown: 0,
    'requires-user-confirmation': 0,
  }[classification];
  return {
    requirementId,
    evidenceIds: score > 0 ? [`evidence-${requirementId}`] : [],
    classification,
    score,
    explanation: `Fictional ${classification} match.`,
  };
}

describe('scoreMatches', () => {
  it('applies all seven canonical weights and produces auditable contributions', () => {
    const result = scoreMatches(
      requirements,
      requirements.map((requirement) => match(requirement.id, 'direct')),
      DEFAULT_SCORING_CONFIG,
    );

    expect(result.overallScore).toBe(100);
    expect(result.contributions).toHaveLength(7);
    expect(result.contributions.reduce((total, item) => total + item.appliedWeight, 0)).toBe(100);
    expect(result.contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requirementId: 'technical', appliedWeight: 35 }),
        expect.objectContaining({ requirementId: 'responsibility', appliedWeight: 20 }),
        expect.objectContaining({ requirementId: 'leadership', appliedWeight: 15 }),
        expect.objectContaining({ requirementId: 'domain', appliedWeight: 10 }),
        expect.objectContaining({ requirementId: 'infrastructure', appliedWeight: 10 }),
        expect.objectContaining({ requirementId: 'preferred', appliedWeight: 5 }),
        expect.objectContaining({ requirementId: 'eligibility', appliedWeight: 5 }),
      ]),
    );
  });

  it('changes only the intended category and keeps blockers separate from score', () => {
    const matches = requirements.map((requirement) =>
      match(requirement.id, requirement.id === 'technical' ? 'unsupported' : 'direct'),
    );
    const withoutBlocker = scoreMatches(requirements, matches, DEFAULT_SCORING_CONFIG);
    const recommendationWithBlocker = recommendFromScore({
      score: withoutBlocker.overallScore,
      requirements,
      matches,
      confidence: 1,
      hasConflicts: false,
      hardBlockers: ['Explicit fictional blocker'],
      config: DEFAULT_SCORING_CONFIG,
    });

    expect(withoutBlocker.overallScore).toBe(65);
    expect(recommendationWithBlocker).toBe('skip');
    expect(withoutBlocker.overallScore).toBe(65);
  });

  it('renormalizes populated categories and guards an empty denominator', () => {
    expect(
      scoreMatches([requirements[0]!], [match('technical', 'direct')], DEFAULT_SCORING_CONFIG)
        .overallScore,
    ).toBe(100);
    expect(scoreMatches([], [], DEFAULT_SCORING_CONFIG)).toEqual({
      contributions: [],
      overallScore: 0,
    });
  });

  it('clamps final rounding so a perfect category cannot exceed 100', () => {
    const repeatedRequirements = Array.from({ length: 6 }, (_, index): JobRequirement => ({
      ...requirements[0]!,
      id: `technical-${index}`,
    }));
    const result = scoreMatches(
      repeatedRequirements,
      repeatedRequirements.map((requirement) => match(requirement.id, 'direct')),
      DEFAULT_SCORING_CONFIG,
    );

    expect(result.overallScore).toBe(100);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(
      Math.round(
        result.contributions.reduce(
          (total, contribution) => total + contribution.pointsAwarded,
          0,
        ) * 1_000_000,
      ) / 1_000_000,
    ).toBe(result.overallScore);
    expect(
      Math.round(
        result.contributions.reduce(
          (total, contribution) => total + contribution.appliedWeight,
          0,
        ) * 1_000_000,
      ) / 1_000_000,
    ).toBe(100);
  });

  it('keeps technical protocols separate from responsibility concepts', () => {
    const protocol: JobRequirement = {
      id: 'protocol',
      category: 'other',
      text: 'GraphQL required',
      normalizedName: 'GraphQL',
      importance: 'required',
    };
    const responsibility: JobRequirement = {
      id: 'backend',
      category: 'other',
      text: 'Backend development required',
      normalizedName: 'Backend development',
      importance: 'required',
    };

    const result = scoreMatches(
      [protocol, responsibility],
      [match('protocol', 'direct'), match('backend', 'direct')],
      DEFAULT_SCORING_CONFIG,
    );

    expect(
      result.contributions.find((item) => item.requirementId === 'protocol')?.scoringCategory,
    ).toBe('required-technical');
    expect(
      result.contributions.find((item) => item.requirementId === 'backend')?.scoringCategory,
    ).toBe('responsibilities');
  });

  it('preserves zero-weight categories while allocating exact auditable totals', () => {
    const technicalRequirements = Array.from({ length: 3 }, (_, index): JobRequirement => ({
      ...requirements[0]!,
      id: `technical-${index}`,
    }));
    const zeroPreferred: JobRequirement = {
      ...requirements[5]!,
      id: 'zero-preferred',
    };
    const config = {
      ...DEFAULT_SCORING_CONFIG,
      weights: {
        ...DEFAULT_SCORING_CONFIG.weights,
        eligibilityLogistics: 10,
        preferred: 0,
      },
    };

    const result = scoreMatches(
      [...technicalRequirements, zeroPreferred],
      [...technicalRequirements, zeroPreferred].map((requirement) =>
        match(requirement.id, 'direct'),
      ),
      config,
    );

    expect(result.overallScore).toBe(100);
    expect(result.contributions.find((item) => item.requirementId === 'zero-preferred')).toEqual(
      expect.objectContaining({ appliedWeight: 0, pointsAwarded: 0 }),
    );
    expect(result.contributions.reduce((total, item) => total + item.appliedWeight, 0)).toBe(100);
    expect(result.contributions.reduce((total, item) => total + item.pointsAwarded, 0)).toBe(100);
  });
});

describe('recommendFromScore', () => {
  const directMatches = requirements.map((requirement) => match(requirement.id, 'direct'));

  it('applies score thresholds and mandatory support rules', () => {
    expect(
      recommendFromScore({
        score: 75,
        requirements,
        matches: directMatches,
        confidence: 1,
        hasConflicts: false,
        hardBlockers: [],
        config: DEFAULT_SCORING_CONFIG,
      }),
    ).toBe('apply');
    expect(
      recommendFromScore({
        score: 55,
        requirements,
        matches: directMatches,
        confidence: 1,
        hasConflicts: false,
        hardBlockers: [],
        config: DEFAULT_SCORING_CONFIG,
      }),
    ).toBe('stretch');
    expect(
      recommendFromScore({
        score: 54.99,
        requirements,
        matches: directMatches,
        confidence: 1,
        hasConflicts: false,
        hardBlockers: [],
        config: DEFAULT_SCORING_CONFIG,
      }),
    ).toBe('skip');
  });

  it('uses manual review for low confidence or conflicts but never hides a blocker', () => {
    const base = {
      score: 90,
      requirements,
      matches: directMatches,
      confidence: 0.5,
      hasConflicts: false,
      hardBlockers: [] as string[],
      config: DEFAULT_SCORING_CONFIG,
    };

    expect(recommendFromScore(base)).toBe('manual-review');
    expect(recommendFromScore({ ...base, confidence: 1, hasConflicts: true })).toBe(
      'manual-review',
    );
    expect(recommendFromScore({ ...base, hardBlockers: ['Known blocker'] })).toBe('skip');
  });

  it('uses manual review when a mandatory requirement remains unknown', () => {
    expect(
      recommendFromScore({
        score: 0,
        requirements: [requirements[0]!],
        matches: [match('technical', 'unknown')],
        confidence: 1,
        hasConflicts: false,
        hardBlockers: [],
        config: DEFAULT_SCORING_CONFIG,
      }),
    ).toBe('manual-review');
  });
});

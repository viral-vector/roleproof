import {
  ScoreContributionSchema,
  type EvidenceMatch,
  type JobRequirement,
  type Recommendation,
  type ScoreContribution,
  type ScoringCategory,
  type ScoringConfig,
} from '@roleproof/shared';

import { compareStableStrings } from './ordering.js';

export interface ScoringResult {
  contributions: ScoreContribution[];
  overallScore: number;
}

interface RecommendationInput {
  confidence: number;
  config: ScoringConfig;
  hardBlockers: string[];
  hasConflicts: boolean;
  matches: EvidenceMatch[];
  requirements: JobRequirement[];
  score: number;
}

const SCORE_SCALE = 1_000_000;

function allocateIntegerTotal(total: number, weights: number[]): number[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0 || weightTotal === 0) {
    return weights.map(() => 0);
  }

  const exact = weights.map((weight) => (total * weight) / weightTotal);
  const allocated = exact.map((value) => Math.floor(value));
  let remainder = total - allocated.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ fraction: value - Math.floor(value), index }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const candidate of order) {
    if (remainder === 0) {
      break;
    }
    allocated[candidate.index]! += 1;
    remainder -= 1;
  }
  return allocated;
}

function roundPointUnits(values: number[]): number[] {
  const target = Math.round(values.reduce((sum, value) => sum + value, 0));
  const allocated = values.map((value) => Math.floor(value));
  let remainder = target - allocated.reduce((sum, value) => sum + value, 0);
  const order = values
    .map((value, index) => ({ fraction: value - Math.floor(value), index }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const candidate of order) {
    if (remainder === 0) {
      break;
    }
    allocated[candidate.index]! += 1;
    remainder -= 1;
  }
  return allocated;
}

function scoringCategory(requirement: JobRequirement): ScoringCategory {
  if (requirement.importance === 'preferred') {
    return 'preferred';
  }
  switch (requirement.category) {
    case 'language':
    case 'framework':
    case 'database':
      return 'required-technical';
    case 'infrastructure':
      return 'infrastructure-delivery';
    case 'leadership':
      return 'seniority-leadership';
    case 'domain':
      return 'domain';
    case 'education':
    case 'location':
    case 'authorization':
    case 'clearance':
    case 'license':
      return 'eligibility-logistics';
    case 'other':
      return ['graphql', 'oauth2', 'openid connect', 'rest api'].includes(
        requirement.normalizedName?.toLocaleLowerCase('en-US') ?? '',
      )
        ? 'required-technical'
        : 'responsibilities';
  }
}

function configuredWeight(category: ScoringCategory, config: ScoringConfig): number {
  switch (category) {
    case 'required-technical':
      return config.weights.requiredTechnical;
    case 'responsibilities':
      return config.weights.responsibilities;
    case 'seniority-leadership':
      return config.weights.seniorityLeadership;
    case 'domain':
      return config.weights.domain;
    case 'infrastructure-delivery':
      return config.weights.infrastructureDelivery;
    case 'preferred':
      return config.weights.preferred;
    case 'eligibility-logistics':
      return config.weights.eligibilityLogistics;
  }
}

export function scoreMatches(
  requirements: JobRequirement[],
  matches: EvidenceMatch[],
  config: ScoringConfig,
): ScoringResult {
  const matchByRequirement = new Map(matches.map((match) => [match.requirementId, match]));
  const grouped = new Map<ScoringCategory, JobRequirement[]>();
  for (const requirement of requirements) {
    if (requirement.importance === 'contextual') {
      continue;
    }
    const category = scoringCategory(requirement);
    const values = grouped.get(category) ?? [];
    values.push(requirement);
    grouped.set(category, values);
  }
  if (grouped.size === 0) {
    return { contributions: [], overallScore: 0 };
  }

  const categories = [...grouped.keys()].sort();
  const categoryUnits = allocateIntegerTotal(
    100 * SCORE_SCALE,
    categories.map((category) => configuredWeight(category, config)),
  );
  const plans: Array<{
    appliedUnits: number;
    category: ScoringCategory;
    match: EvidenceMatch | undefined;
    requirement: JobRequirement;
  }> = [];
  for (const [categoryIndex, category] of categories.entries()) {
    const categoryRequirements = [...(grouped.get(category) ?? [])].sort((left, right) =>
      compareStableStrings(left.id, right.id),
    );
    const requirementUnits = allocateIntegerTotal(
      categoryUnits[categoryIndex] ?? 0,
      categoryRequirements.map(() => 1),
    );

    for (const [requirementIndex, requirement] of categoryRequirements.entries()) {
      plans.push({
        appliedUnits: requirementUnits[requirementIndex] ?? 0,
        category,
        match: matchByRequirement.get(requirement.id),
        requirement,
      });
    }
  }

  const pointUnits = roundPointUnits(
    plans.map((plan) => plan.appliedUnits * (plan.match?.score ?? 0)),
  );
  const contributions = plans
    .map((plan, index) => {
      const appliedWeight = plan.appliedUnits / SCORE_SCALE;
      const pointsAwarded = (pointUnits[index] ?? 0) / SCORE_SCALE;
      return ScoreContributionSchema.parse({
        requirementId: plan.requirement.id,
        scoringCategory: plan.category,
        classification: plan.match?.classification ?? 'unknown',
        evidenceIds: plan.match?.evidenceIds ?? [],
        appliedWeight,
        pointsAwarded,
        explanation: `${pointsAwarded} of ${appliedWeight} points: ${plan.match?.explanation ?? 'No match result was available.'}`,
      });
    })
    .sort((left, right) => compareStableStrings(left.requirementId, right.requirementId));
  const overallScore = pointUnits.reduce((total, points) => total + points, 0) / SCORE_SCALE;

  return {
    contributions,
    overallScore,
  };
}

export function recommendFromScore(input: RecommendationInput): Recommendation {
  if (input.hardBlockers.length > 0) {
    return 'skip';
  }
  if (
    input.requirements.length === 0 ||
    input.hasConflicts ||
    input.confidence < input.config.thresholds.lowConfidence
  ) {
    return 'manual-review';
  }

  const matchByRequirement = new Map(input.matches.map((match) => [match.requirementId, match]));
  const mandatory = input.requirements.filter(
    (requirement) => requirement.importance === 'required',
  );
  if (
    mandatory.some((requirement) => {
      const classification = matchByRequirement.get(requirement.id)?.classification;
      return (
        classification === undefined ||
        classification === 'unknown' ||
        classification === 'requires-user-confirmation'
      );
    })
  ) {
    return 'manual-review';
  }
  const stronglySupported = mandatory.filter((requirement) => {
    const classification = matchByRequirement.get(requirement.id)?.classification;
    return classification === 'direct' || classification === 'strongly-related';
  });
  const supportRatio = mandatory.length === 0 ? 0 : stronglySupported.length / mandatory.length;

  if (
    input.score >= input.config.thresholds.applyMinimum &&
    supportRatio >= input.config.thresholds.mandatorySupportRatio
  ) {
    return 'apply';
  }
  if (input.score >= input.config.thresholds.stretchMinimum) {
    return 'stretch';
  }
  return 'skip';
}

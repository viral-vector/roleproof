import { ScoringConfigSchema, type ScoringConfig } from '@roleproof/shared';

export const MAX_EVIDENCE_REFERENCES_PER_MATCH = 100;
export const MAX_ANALYZED_REQUIREMENTS = 500;

export const DEFAULT_SCORING_CONFIG: Readonly<ScoringConfig> = Object.freeze(
  ScoringConfigSchema.parse({
    version: '1.0.0',
    weights: {
      requiredTechnical: 35,
      responsibilities: 20,
      seniorityLeadership: 15,
      domain: 10,
      infrastructureDelivery: 10,
      preferred: 5,
      eligibilityLogistics: 5,
    },
    matchValues: {
      direct: 1,
      'strongly-related': 0.75,
      'partially-related': 0.4,
      unsupported: 0,
      unknown: 0,
      'requires-user-confirmation': 0,
    },
    thresholds: {
      applyMinimum: 75,
      stretchMinimum: 55,
      lowConfidence: 0.6,
      mandatorySupportRatio: 0.6,
    },
  }),
);

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AnalysisMetadataSchema,
  AnalysisResultSchema,
  CandidateProfileSchema,
  CareerEvidenceCategorySchema,
  CareerEvidenceSchema,
  EvidenceConfidenceSchema,
  EvidenceMatchSchema,
  JobRequirementCategorySchema,
  JobRequirementImportanceSchema,
  JobRequirementSchema,
  MatchClassificationSchema,
  RecommendationSchema,
  SuggestionSchema,
  UnsupportedClaimSchema,
  type AnalysisResult,
  type CandidateProfile,
} from '../src/index.js';

const candidateProfile = {
  id: 'profile-1',
  name: 'Avery Morgan',
  targetTitles: ['Backend Engineer'],
  preferredLocations: ['Remote'],
  remotePreference: 'remote',
  targetSalaryMin: 120_000,
  targetSalaryMax: 150_000,
  workAuthorization: 'Authorized without sponsorship',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as const;

const careerEvidence = {
  id: 'evidence-1',
  profileId: 'profile-1',
  category: 'skill',
  name: 'TypeScript',
  normalizedName: 'typescript',
  description: 'Built fictional backend services with TypeScript.',
  employer: 'Fictional Systems',
  project: 'Sample API',
  startDate: '2023-01',
  endDate: '2025-01',
  sourceDocumentId: 'document-1',
  sourceText: 'Built backend services with TypeScript.',
  confidence: 'explicit',
} as const;

const jobRequirement = {
  id: 'requirement-1',
  category: 'language',
  text: 'Production TypeScript experience is required.',
  normalizedName: 'typescript',
  importance: 'required',
  yearsRequested: 3,
} as const;

const evidenceMatch = {
  requirementId: 'requirement-1',
  evidenceIds: ['evidence-1'],
  classification: 'direct',
  score: 1,
  explanation: 'The fictional resume explicitly names TypeScript.',
} as const;

const suggestion = {
  text: 'Emphasize the TypeScript API work.',
  classification: 'direct',
  evidenceIds: ['evidence-1'],
  explanation: 'The source evidence directly supports this emphasis.',
} as const;

const analysisResult = {
  schemaVersion: '1.0',
  id: 'analysis-1',
  profileId: 'profile-1',
  resumeDocumentId: 'document-1',
  jobId: 'job-1',
  overallScore: 82,
  recommendation: 'apply',
  confidence: 0.9,
  hardBlockers: [],
  matchedRequirements: [evidenceMatch],
  missingRequirements: [],
  unsupportedClaims: [
    {
      text: 'Production Go experience',
      classification: 'unsupported',
      evidenceIds: [],
      explanation: 'No supplied evidence mentions Go.',
    },
  ],
  suggestedEmphasis: [suggestion],
  suggestedAdditions: [
    {
      text: 'Confirm whether mentoring responsibilities should be included.',
      classification: 'requires-user-confirmation',
      evidenceIds: [],
      explanation: 'The source wording is ambiguous.',
    },
  ],
  interviewTopics: ['TypeScript service design'],
  generatedAt: '2026-01-01T00:00:00.000Z',
  metadata: {
    mode: 'deterministic',
    engineVersion: '0.0.0',
  },
} as const;

describe('CandidateProfileSchema', () => {
  it('accepts a complete fictional profile and exports its inferred type', () => {
    const parsed = CandidateProfileSchema.parse(candidateProfile);

    expect(parsed).toEqual(candidateProfile);
    expectTypeOf(parsed).toEqualTypeOf<CandidateProfile>();
  });

  it.each([
    { targetSalaryMin: -1 },
    { targetSalaryMin: Number.NaN },
    { targetSalaryMax: Number.POSITIVE_INFINITY },
    { targetSalaryMin: 160_000, targetSalaryMax: 150_000 },
  ])('rejects an invalid salary configuration: %o', (salaryFields) => {
    expect(CandidateProfileSchema.safeParse({ ...candidateProfile, ...salaryFields }).success).toBe(
      false,
    );
  });

  it('rejects invalid preferences, missing fields, and unknown fields', () => {
    expect(
      CandidateProfileSchema.safeParse({ ...candidateProfile, remotePreference: 'sometimes' })
        .success,
    ).toBe(false);
    expect(CandidateProfileSchema.safeParse({ ...candidateProfile, id: undefined }).success).toBe(
      false,
    );
    expect(
      CandidateProfileSchema.safeParse({ ...candidateProfile, secret: 'unexpected' }).success,
    ).toBe(false);
  });
});

describe('CareerEvidenceSchema', () => {
  it.each(['skill', 'project', 'responsibility', 'achievement', 'domain', 'leadership'])(
    'accepts the %s category',
    (category) => {
      expect(CareerEvidenceCategorySchema.safeParse(category).success).toBe(true);
    },
  );

  it.each(['explicit', 'inferred', 'user-confirmed'])(
    'accepts the %s confidence classification',
    (confidence) => {
      expect(EvidenceConfidenceSchema.safeParse(confidence).success).toBe(true);
    },
  );

  it('accepts complete fictional evidence', () => {
    expect(CareerEvidenceSchema.parse(careerEvidence)).toEqual(careerEvidence);
  });

  it('rejects an invalid category, confidence, or blank required text', () => {
    expect(
      CareerEvidenceSchema.safeParse({ ...careerEvidence, category: 'certification' }).success,
    ).toBe(false);
    expect(
      CareerEvidenceSchema.safeParse({ ...careerEvidence, confidence: 'likely' }).success,
    ).toBe(false);
    expect(CareerEvidenceSchema.safeParse({ ...careerEvidence, description: '   ' }).success).toBe(
      false,
    );
  });
});

describe('JobRequirementSchema', () => {
  it.each([
    'language',
    'framework',
    'database',
    'infrastructure',
    'domain',
    'leadership',
    'education',
    'location',
    'authorization',
    'clearance',
    'license',
    'other',
  ])('accepts the %s category', (category) => {
    expect(JobRequirementCategorySchema.safeParse(category).success).toBe(true);
  });

  it.each(['required', 'preferred', 'contextual'])('accepts the %s importance', (importance) => {
    expect(JobRequirementImportanceSchema.safeParse(importance).success).toBe(true);
  });

  it('accepts a complete fictional requirement', () => {
    expect(JobRequirementSchema.parse(jobRequirement)).toEqual(jobRequirement);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid years requested: %s',
    (yearsRequested) => {
      expect(JobRequirementSchema.safeParse({ ...jobRequirement, yearsRequested }).success).toBe(
        false,
      );
    },
  );
});

describe('EvidenceMatchSchema', () => {
  it.each([
    'direct',
    'strongly-related',
    'partially-related',
    'unsupported',
    'unknown',
    'requires-user-confirmation',
  ])('accepts the %s classification', (classification) => {
    expect(MatchClassificationSchema.safeParse(classification).success).toBe(true);
  });

  it('accepts a complete evidence match', () => {
    expect(EvidenceMatchSchema.parse(evidenceMatch)).toEqual(evidenceMatch);
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid match score: %s',
    (score) => {
      expect(EvidenceMatchSchema.safeParse({ ...evidenceMatch, score }).success).toBe(false);
    },
  );

  it.each([
    ['direct', 0.75],
    ['strongly-related', 1],
    ['partially-related', 0.75],
    ['unsupported', 0.4],
    ['unknown', 1],
    ['requires-user-confirmation', 0.4],
  ])('rejects a %s classification with the non-canonical score %s', (classification, score) => {
    expect(EvidenceMatchSchema.safeParse({ ...evidenceMatch, classification, score }).success).toBe(
      false,
    );
  });

  it.each([
    ['direct', 1, ['evidence-1']],
    ['strongly-related', 0.75, ['evidence-1']],
    ['partially-related', 0.4, ['evidence-1']],
    ['unsupported', 0, []],
    ['unknown', 0, []],
    ['requires-user-confirmation', 0, []],
  ])('accepts the canonical %s score %s', (classification, score, evidenceIds) => {
    expect(
      EvidenceMatchSchema.safeParse({ ...evidenceMatch, classification, evidenceIds, score })
        .success,
    ).toBe(true);
  });

  it.each([
    ['direct', 1],
    ['strongly-related', 0.75],
    ['partially-related', 0.4],
  ])('requires evidence IDs for a %s match', (classification, score) => {
    expect(
      EvidenceMatchSchema.safeParse({
        ...evidenceMatch,
        classification,
        evidenceIds: [],
        score,
      }).success,
    ).toBe(false);
  });
});

describe('truth-supporting schemas', () => {
  it('accepts unsupported claims only with a risk classification and explanation', () => {
    const unsupportedClaim = analysisResult.unsupportedClaims[0];

    expect(UnsupportedClaimSchema.safeParse(unsupportedClaim).success).toBe(true);
    expect(
      UnsupportedClaimSchema.safeParse({ ...unsupportedClaim, classification: 'direct' }).success,
    ).toBe(false);
    expect(
      UnsupportedClaimSchema.safeParse({ ...unsupportedClaim, explanation: ' ' }).success,
    ).toBe(false);
  });

  it('requires evidence for supported suggestions', () => {
    expect(SuggestionSchema.safeParse(suggestion).success).toBe(true);
    expect(SuggestionSchema.safeParse({ ...suggestion, evidenceIds: [] }).success).toBe(false);
  });

  it('allows an evidence-free suggestion only when user confirmation is required', () => {
    expect(SuggestionSchema.safeParse(analysisResult.suggestedAdditions[0]).success).toBe(true);
    expect(
      SuggestionSchema.safeParse({
        ...analysisResult.suggestedAdditions[0],
        classification: 'unknown',
      }).success,
    ).toBe(false);
  });
});

describe('AnalysisMetadataSchema', () => {
  it.each(['deterministic', 'ai-enhanced'])('accepts the %s mode', (mode) => {
    expect(AnalysisMetadataSchema.safeParse({ ...analysisResult.metadata, mode }).success).toBe(
      true,
    );
  });

  it('rejects an unknown mode or blank engine version', () => {
    expect(
      AnalysisMetadataSchema.safeParse({ ...analysisResult.metadata, mode: 'hosted' }).success,
    ).toBe(false);
    expect(
      AnalysisMetadataSchema.safeParse({ ...analysisResult.metadata, engineVersion: ' ' }).success,
    ).toBe(false);
  });
});

describe('AnalysisResultSchema 1.0 compatibility contract', () => {
  it.each(['apply', 'stretch', 'skip', 'manual-review'])(
    'accepts the %s recommendation',
    (recommendation) => {
      expect(RecommendationSchema.safeParse(recommendation).success).toBe(true);
    },
  );

  it('accepts the canonical fictional 1.0 result and exports its inferred type', () => {
    const parsed = AnalysisResultSchema.parse(analysisResult);

    expect(parsed).toEqual(analysisResult);
    expectTypeOf(parsed).toEqualTypeOf<AnalysisResult>();
  });

  it('rejects another schema version or recommendation', () => {
    expect(
      AnalysisResultSchema.safeParse({ ...analysisResult, schemaVersion: '1.1' }).success,
    ).toBe(false);
    expect(
      AnalysisResultSchema.safeParse({ ...analysisResult, recommendation: 'maybe' }).success,
    ).toBe(false);
  });

  it.each([-0.01, 100.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid overall score: %s',
    (overallScore) => {
      expect(AnalysisResultSchema.safeParse({ ...analysisResult, overallScore }).success).toBe(
        false,
      );
    },
  );

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid confidence: %s',
    (confidence) => {
      expect(AnalysisResultSchema.safeParse({ ...analysisResult, confidence }).success).toBe(false);
    },
  );

  it('rejects missing required fields and unknown fields', () => {
    expect(AnalysisResultSchema.safeParse({ ...analysisResult, metadata: undefined }).success).toBe(
      false,
    );
    expect(AnalysisResultSchema.safeParse({ ...analysisResult, probability: 0.82 }).success).toBe(
      false,
    );
  });
});

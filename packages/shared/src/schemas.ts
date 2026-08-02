import { z } from 'zod';

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank',
});

const idSchema = nonBlankStringSchema;
const finiteNonNegativeNumberSchema = z.number().finite().nonnegative();
const unitIntervalSchema = z.number().finite().min(0).max(1);

export const RemotePreferenceSchema = z.enum(['remote', 'hybrid', 'onsite', 'any']);

export const CandidateProfileSchema = z
  .object({
    id: idSchema,
    name: nonBlankStringSchema.optional(),
    targetTitles: z.array(nonBlankStringSchema),
    preferredLocations: z.array(nonBlankStringSchema),
    remotePreference: RemotePreferenceSchema.optional(),
    targetSalaryMin: finiteNonNegativeNumberSchema.optional(),
    targetSalaryMax: finiteNonNegativeNumberSchema.optional(),
    workAuthorization: nonBlankStringSchema.optional(),
    createdAt: nonBlankStringSchema,
    updatedAt: nonBlankStringSchema,
  })
  .strict()
  .superRefine((profile, context) => {
    if (
      profile.targetSalaryMin !== undefined &&
      profile.targetSalaryMax !== undefined &&
      profile.targetSalaryMin > profile.targetSalaryMax
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Target salary minimum must not exceed the maximum',
        path: ['targetSalaryMin'],
      });
    }
  });

export const CareerEvidenceCategorySchema = z.enum([
  'skill',
  'project',
  'responsibility',
  'achievement',
  'domain',
  'leadership',
]);

export const EvidenceConfidenceSchema = z.enum(['explicit', 'inferred', 'user-confirmed']);

export const CareerEvidenceSchema = z
  .object({
    id: idSchema,
    profileId: idSchema,
    category: CareerEvidenceCategorySchema,
    name: nonBlankStringSchema,
    normalizedName: nonBlankStringSchema.optional(),
    description: nonBlankStringSchema,
    employer: nonBlankStringSchema.optional(),
    project: nonBlankStringSchema.optional(),
    startDate: nonBlankStringSchema.optional(),
    endDate: nonBlankStringSchema.optional(),
    sourceDocumentId: idSchema,
    sourceText: nonBlankStringSchema.optional(),
    confidence: EvidenceConfidenceSchema,
  })
  .strict();

export const JobRequirementCategorySchema = z.enum([
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
]);

export const JobRequirementImportanceSchema = z.enum(['required', 'preferred', 'contextual']);

export const JobRequirementSchema = z
  .object({
    id: idSchema,
    category: JobRequirementCategorySchema,
    text: nonBlankStringSchema,
    normalizedName: nonBlankStringSchema.optional(),
    importance: JobRequirementImportanceSchema,
    yearsRequested: finiteNonNegativeNumberSchema.optional(),
  })
  .strict();

export const MatchClassificationSchema = z.enum([
  'direct',
  'strongly-related',
  'partially-related',
  'unsupported',
  'unknown',
  'requires-user-confirmation',
]);

export const MATCH_VALUES = Object.freeze({
  direct: 1,
  'strongly-related': 0.75,
  'partially-related': 0.4,
  unsupported: 0,
  unknown: 0,
  'requires-user-confirmation': 0,
} as const);

export const EvidenceMatchSchema = z
  .object({
    requirementId: idSchema,
    evidenceIds: z.array(idSchema),
    classification: MatchClassificationSchema,
    score: unitIntervalSchema,
    explanation: nonBlankStringSchema,
  })
  .strict()
  .superRefine((match, context) => {
    if (match.score !== MATCH_VALUES[match.classification]) {
      context.addIssue({
        code: 'custom',
        message: `Score must be ${MATCH_VALUES[match.classification]} for ${match.classification}`,
        path: ['score'],
      });
    }

    if (MATCH_VALUES[match.classification] > 0 && match.evidenceIds.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'A supported match must reference evidence',
        path: ['evidenceIds'],
      });
    }
  });

export const UnsupportedClaimSchema = z
  .object({
    text: nonBlankStringSchema,
    classification: z.enum(['unsupported', 'unknown', 'requires-user-confirmation']),
    evidenceIds: z.array(idSchema),
    explanation: nonBlankStringSchema,
  })
  .strict();

export const SuggestionSchema = z
  .object({
    text: nonBlankStringSchema,
    classification: MatchClassificationSchema,
    evidenceIds: z.array(idSchema),
    explanation: nonBlankStringSchema,
  })
  .strict()
  .superRefine((suggestion, context) => {
    if (
      suggestion.evidenceIds.length === 0 &&
      suggestion.classification !== 'requires-user-confirmation'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A suggestion needs supporting evidence or user confirmation',
        path: ['evidenceIds'],
      });
    }
  });

export const RecommendationSchema = z.enum(['apply', 'stretch', 'skip', 'manual-review']);

export const ScoringCategorySchema = z.enum([
  'required-technical',
  'responsibilities',
  'seniority-leadership',
  'domain',
  'infrastructure-delivery',
  'preferred',
  'eligibility-logistics',
]);

export const ScoreContributionSchema = z
  .object({
    requirementId: idSchema,
    scoringCategory: ScoringCategorySchema,
    classification: MatchClassificationSchema,
    evidenceIds: z.array(idSchema),
    appliedWeight: z.number().finite().min(0).max(100),
    pointsAwarded: z.number().finite().min(0).max(100),
    explanation: nonBlankStringSchema,
  })
  .strict()
  .superRefine((contribution, context) => {
    if (contribution.pointsAwarded > contribution.appliedWeight) {
      context.addIssue({
        code: 'custom',
        message: 'Points awarded must not exceed the applied weight',
        path: ['pointsAwarded'],
      });
    }

    if (MATCH_VALUES[contribution.classification] > 0 && contribution.evidenceIds.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'A supported score contribution must reference evidence',
        path: ['evidenceIds'],
      });
    }

    if (MATCH_VALUES[contribution.classification] === 0 && contribution.pointsAwarded !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'An unsupported score contribution cannot award points',
        path: ['pointsAwarded'],
      });
    }
  });

export const AnalysisParsingMetadataSchema = z
  .object({
    resumeConfidence: unitIntervalSchema,
    jobConfidence: unitIntervalSchema,
    warnings: z.array(nonBlankStringSchema),
  })
  .strict();

export const JobSourceClassificationSchema = z.enum([
  'official-employer',
  'official-ats',
  'recruiter',
  'aggregator',
  'unknown',
  'removed-unavailable',
]);

export const AtsProviderSchema = z.enum([
  'greenhouse',
  'lever',
  'workday',
  'ashby',
  'paylocity',
  'rippling',
  'jazzhr',
  'smartrecruiters',
  'unknown',
]);

export const JobSourceWarningCodeSchema = z.enum([
  'redirect-followed',
  'non-html-content',
  'empty-extraction',
  'low-text-content',
  'page-likely-blocked',
  'page-seems-removed',
  'removed-page',
  'unavailable-content',
  'size-limit',
  'timeout',
  'fetch-failed',
  'invalid-url',
]);

export const JobSourceWarningSchema = z
  .object({
    code: JobSourceWarningCodeSchema,
    message: nonBlankStringSchema,
  })
  .strict();

export const JobRetrievalMetadataSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    url: nonBlankStringSchema.max(4096),
    finalUrl: nonBlankStringSchema.max(4096).optional(),
    retrievedAt: nonBlankStringSchema,
    statusCode: z.number().int().min(100).max(599).optional(),
    contentType: nonBlankStringSchema.max(255).optional(),
    sourceClassification: JobSourceClassificationSchema,
    atsProvider: AtsProviderSchema,
    removedOrUnavailable: z.boolean(),
    confidence: unitIntervalSchema,
    warnings: z.array(JobSourceWarningSchema),
  })
  .strict()
  .superRefine((metadata, context) => {
    if (metadata.sourceClassification === 'official-ats' && metadata.atsProvider === 'unknown') {
      context.addIssue({
        code: 'custom',
        message: 'An official ATS page must identify its ATS provider',
        path: ['atsProvider'],
      });
    }
    if (
      metadata.removedOrUnavailable !==
      (metadata.sourceClassification === 'removed-unavailable')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'removedOrUnavailable must match the source classification',
        path: ['removedOrUnavailable'],
      });
    }
  });

export const AnalysisMetadataSchema = z
  .object({
    mode: z.enum(['deterministic', 'ai-enhanced']),
    engineVersion: nonBlankStringSchema,
    normalizationVersion: nonBlankStringSchema.optional(),
    scoringVersion: nonBlankStringSchema.optional(),
    parsing: AnalysisParsingMetadataSchema.optional(),
    jobSource: JobRetrievalMetadataSchema.optional(),
  })
  .strict();

export const AnalysisResultSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    id: idSchema,
    profileId: idSchema.optional(),
    resumeDocumentId: idSchema.optional(),
    jobId: idSchema.optional(),
    overallScore: z.number().finite().min(0).max(100),
    recommendation: RecommendationSchema,
    confidence: unitIntervalSchema,
    hardBlockers: z.array(nonBlankStringSchema),
    matchedRequirements: z.array(EvidenceMatchSchema),
    missingRequirements: z.array(JobRequirementSchema),
    unsupportedClaims: z.array(UnsupportedClaimSchema),
    suggestedEmphasis: z.array(SuggestionSchema),
    suggestedAdditions: z.array(SuggestionSchema),
    interviewTopics: z.array(nonBlankStringSchema),
    generatedAt: nonBlankStringSchema,
    metadata: AnalysisMetadataSchema,
    scoreContributions: z.array(ScoreContributionSchema).optional(),
  })
  .strict();

export type RemotePreference = z.infer<typeof RemotePreferenceSchema>;
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;
export type CareerEvidenceCategory = z.infer<typeof CareerEvidenceCategorySchema>;
export type EvidenceConfidence = z.infer<typeof EvidenceConfidenceSchema>;
export type CareerEvidence = z.infer<typeof CareerEvidenceSchema>;
export type JobRequirementCategory = z.infer<typeof JobRequirementCategorySchema>;
export type JobRequirementImportance = z.infer<typeof JobRequirementImportanceSchema>;
export type JobRequirement = z.infer<typeof JobRequirementSchema>;
export type MatchClassification = z.infer<typeof MatchClassificationSchema>;
export type EvidenceMatch = z.infer<typeof EvidenceMatchSchema>;
export type UnsupportedClaim = z.infer<typeof UnsupportedClaimSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type ScoringCategory = z.infer<typeof ScoringCategorySchema>;
export type ScoreContribution = z.infer<typeof ScoreContributionSchema>;
export type AnalysisParsingMetadata = z.infer<typeof AnalysisParsingMetadataSchema>;
export type AnalysisMetadata = z.infer<typeof AnalysisMetadataSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type JobSourceClassification = z.infer<typeof JobSourceClassificationSchema>;
export type AtsProvider = z.infer<typeof AtsProviderSchema>;
export type JobSourceWarningCode = z.infer<typeof JobSourceWarningCodeSchema>;
export type JobSourceWarning = z.infer<typeof JobSourceWarningSchema>;
export type JobRetrievalMetadata = z.infer<typeof JobRetrievalMetadataSchema>;

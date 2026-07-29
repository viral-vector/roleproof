import { z } from 'zod';

import {
  AnalysisResultSchema,
  CareerEvidenceSchema,
  RemotePreferenceSchema,
  type AnalysisResult,
} from './schemas.js';

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank',
});
const finiteNonNegativeNumberSchema = z.number().finite().nonnegative();
const positiveIntegerSchema = z.number().int().finite().positive();
const unitIntervalSchema = z.number().finite().min(0).max(1);

export const ParseWarningCodeSchema = z.enum([
  'pdf-empty-page',
  'pdf-low-text-content',
  'possible-truncation',
  'ambiguous-layout',
]);

export const ParseWarningSchema = z
  .object({
    code: ParseWarningCodeSchema,
    message: nonBlankStringSchema,
  })
  .strict();

export const ParsedDocumentSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    id: nonBlankStringSchema,
    kind: z.enum(['resume', 'job']),
    format: z.enum(['plaintext', 'pdf']),
    text: nonBlankStringSchema,
    confidence: unitIntervalSchema,
    warnings: z.array(ParseWarningSchema),
  })
  .strict()
  .superRefine((document, context) => {
    if (document.kind === 'job' && document.format === 'pdf') {
      context.addIssue({
        code: 'custom',
        message: 'Phase 1 job documents must be plaintext',
        path: ['format'],
      });
    }
  });

export const CandidateContextSchema = z
  .object({
    preferredLocations: z.array(nonBlankStringSchema),
    remotePreference: RemotePreferenceSchema.optional(),
    targetSalaryMin: finiteNonNegativeNumberSchema.optional(),
    targetSalaryMax: finiteNonNegativeNumberSchema.optional(),
    workAuthorization: nonBlankStringSchema.optional(),
    clearances: z.array(nonBlankStringSchema),
    licenses: z.array(nonBlankStringSchema),
    education: z.array(nonBlankStringSchema),
    certifications: z.array(nonBlankStringSchema),
  })
  .strict()
  .superRefine((context, refinementContext) => {
    if (
      context.targetSalaryMin !== undefined &&
      context.targetSalaryMax !== undefined &&
      context.targetSalaryMin > context.targetSalaryMax
    ) {
      refinementContext.addIssue({
        code: 'custom',
        message: 'Target salary minimum must not exceed the maximum',
        path: ['targetSalaryMin'],
      });
    }
  });

const DeterministicAnalysisInputBaseSchema = z
  .object({
    resume: ParsedDocumentSchema,
    job: ParsedDocumentSchema,
    candidateContext: CandidateContextSchema,
  })
  .strict();

function validateDocumentRoles(
  input: z.infer<typeof DeterministicAnalysisInputBaseSchema>,
  context: z.RefinementCtx,
): void {
  if (input.resume.kind !== 'resume') {
    context.addIssue({
      code: 'custom',
      message: 'Resume input must have resume document kind',
      path: ['resume', 'kind'],
    });
  }

  if (input.job.kind !== 'job') {
    context.addIssue({
      code: 'custom',
      message: 'Job input must have job document kind',
      path: ['job', 'kind'],
    });
  }
}

export const DeterministicAnalysisInputSchema =
  DeterministicAnalysisInputBaseSchema.superRefine(validateDocumentRoles);

export const EvidenceAwareDeterministicAnalysisInputSchema =
  DeterministicAnalysisInputBaseSchema.extend({
    profileId: nonBlankStringSchema.optional(),
    evidence: z.array(CareerEvidenceSchema),
  })
    .strict()
    .superRefine((input, context) => {
      validateDocumentRoles(input, context);
      if (input.profileId === undefined) {
        return;
      }
      for (const [index, evidence] of input.evidence.entries()) {
        if (evidence.profileId !== input.profileId) {
          context.addIssue({
            code: 'custom',
            message: 'Evidence must belong to the supplied profile',
            path: ['evidence', index, 'profileId'],
          });
        }
      }
    });

export const SkillAliasCategorySchema = z.enum([
  'language',
  'framework',
  'database',
  'infrastructure',
  'domain',
  'leadership',
  'other',
]);

export const SkillAliasDataSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    skills: z.array(
      z
        .object({
          canonicalName: nonBlankStringSchema,
          category: SkillAliasCategorySchema,
          aliases: z.array(nonBlankStringSchema),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((data, context) => {
    const owners = new Map<string, string>();

    for (const [skillIndex, skill] of data.skills.entries()) {
      for (const name of [skill.canonicalName, ...skill.aliases]) {
        const key = name.trim().toLocaleLowerCase('en-US');
        const owner = owners.get(key);
        if (owner !== undefined && owner !== skill.canonicalName) {
          context.addIssue({
            code: 'custom',
            message: `Alias ${name} is assigned to multiple canonical skills`,
            path: ['skills', skillIndex, 'aliases'],
          });
        } else {
          owners.set(key, skill.canonicalName);
        }
      }
    }
  });

export const SkillRelationshipDataSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    relationships: z.array(
      z
        .object({
          source: nonBlankStringSchema,
          target: nonBlankStringSchema,
          direction: z.enum(['directed', 'bidirectional']),
          classification: z.enum(['strongly-related', 'partially-related']),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((data, context) => {
    for (const [index, relationship] of data.relationships.entries()) {
      if (
        relationship.source.trim().toLocaleLowerCase('en-US') ===
        relationship.target.trim().toLocaleLowerCase('en-US')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'A skill cannot be related to itself',
          path: ['relationships', index, 'target'],
        });
      }
    }
  });

export const ParserConfigSchema = z
  .object({
    maxTextBytes: positiveIntegerSchema,
    maxPdfBytes: positiveIntegerSchema,
    pdfTimeoutMs: positiveIntegerSchema,
    maxPdfPages: positiveIntegerSchema,
    maxImagePixels: positiveIntegerSchema,
  })
  .strict();

export const ScoringConfigSchema = z
  .object({
    version: nonBlankStringSchema,
    weights: z
      .object({
        requiredTechnical: z.number().finite().nonnegative(),
        responsibilities: z.number().finite().nonnegative(),
        seniorityLeadership: z.number().finite().nonnegative(),
        domain: z.number().finite().nonnegative(),
        infrastructureDelivery: z.number().finite().nonnegative(),
        preferred: z.number().finite().nonnegative(),
        eligibilityLogistics: z.number().finite().nonnegative(),
      })
      .strict(),
    matchValues: z
      .object({
        direct: z.literal(1),
        'strongly-related': z.literal(0.75),
        'partially-related': z.literal(0.4),
        unsupported: z.literal(0),
        unknown: z.literal(0),
        'requires-user-confirmation': z.literal(0),
      })
      .strict(),
    thresholds: z
      .object({
        applyMinimum: z.number().finite().min(0).max(100),
        stretchMinimum: z.number().finite().min(0).max(100),
        lowConfidence: unitIntervalSchema,
        mandatorySupportRatio: unitIntervalSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((config, context) => {
    const weightTotal = Object.values(config.weights).reduce((total, weight) => total + weight, 0);
    if (Math.abs(weightTotal - 100) > Number.EPSILON) {
      context.addIssue({
        code: 'custom',
        message: 'Scoring weights must total 100',
        path: ['weights'],
      });
    }

    if (config.thresholds.stretchMinimum >= config.thresholds.applyMinimum) {
      context.addIssue({
        code: 'custom',
        message: 'Stretch threshold must be below the apply threshold',
        path: ['thresholds', 'stretchMinimum'],
      });
    }
  });

export const AnalysisEnvelopeSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    analysis: AnalysisResultSchema,
  })
  .strict();

export type ParseWarningCode = z.infer<typeof ParseWarningCodeSchema>;
export type ParseWarning = z.infer<typeof ParseWarningSchema>;
export type ParsedDocument = z.infer<typeof ParsedDocumentSchema>;
export type CandidateContext = z.infer<typeof CandidateContextSchema>;
export type DeterministicAnalysisInput = z.infer<typeof DeterministicAnalysisInputSchema>;
export type EvidenceAwareDeterministicAnalysisInput = z.infer<
  typeof EvidenceAwareDeterministicAnalysisInputSchema
>;
export type SkillAliasCategory = z.infer<typeof SkillAliasCategorySchema>;
export type SkillAliasData = z.infer<typeof SkillAliasDataSchema>;
export type SkillRelationshipData = z.infer<typeof SkillRelationshipDataSchema>;
export type ParserConfig = z.infer<typeof ParserConfigSchema>;
export type ScoringConfig = z.infer<typeof ScoringConfigSchema>;
export type AnalysisEnvelope = z.infer<typeof AnalysisEnvelopeSchema>;

export type Phase1AnalysisResult = AnalysisResult & {
  scoreContributions: NonNullable<AnalysisResult['scoreContributions']>;
};

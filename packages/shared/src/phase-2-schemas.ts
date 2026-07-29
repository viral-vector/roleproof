import { z } from 'zod';

import { ParseWarningSchema } from './phase-1-schemas.js';
import {
  AnalysisResultSchema,
  CandidateProfileSchema,
  CareerEvidenceSchema,
  EvidenceConfidenceSchema,
  RecommendationSchema,
} from './schemas.js';

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank',
});
const sha256Schema = z.string().regex(/^[a-f\d]{64}$/u, 'Value must be a lowercase SHA-256 hash');
const unitIntervalSchema = z.number().finite().min(0).max(1);

export const StoredDocumentSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    id: nonBlankStringSchema,
    profileId: nonBlankStringSchema,
    kind: z.enum(['resume', 'evidence-note']),
    format: z.enum(['plaintext', 'pdf']),
    originalName: nonBlankStringSchema.optional(),
    contentSha256: sha256Schema,
    parsedContentSha256: sha256Schema,
    text: nonBlankStringSchema,
    confidence: unitIntervalSchema,
    warnings: z.array(ParseWarningSchema),
    createdAt: nonBlankStringSchema,
    updatedAt: nonBlankStringSchema,
  })
  .strict()
  .superRefine((document, context) => {
    if (document.kind === 'evidence-note' && document.format !== 'plaintext') {
      context.addIssue({
        code: 'custom',
        message: 'Evidence notes must be plaintext',
        path: ['format'],
      });
    }
  });

export const StoredJobSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    id: nonBlankStringSchema,
    format: z.literal('plaintext'),
    contentSha256: sha256Schema,
    parsedContentSha256: sha256Schema,
    text: nonBlankStringSchema,
    confidence: unitIntervalSchema,
    warnings: z.array(ParseWarningSchema),
    createdAt: nonBlankStringSchema,
    updatedAt: nonBlankStringSchema,
  })
  .strict();

export const DuplicateDocumentStatusSchema = z.enum(['none', 'exact', 'same-parsed-content']);

export const DuplicateDocumentResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none') }).strict(),
  z.object({ status: z.literal('exact'), document: StoredDocumentSchema }).strict(),
  z.object({ status: z.literal('same-parsed-content'), document: StoredDocumentSchema }).strict(),
]);

export const EvidenceReferenceSchema = z
  .object({
    evidenceId: nonBlankStringSchema,
    sourceType: z.enum(['career-evidence', 'profile-fact', 'resume-text']),
    sourceId: nonBlankStringSchema,
    sourceDocumentId: nonBlankStringSchema.optional(),
    sourceText: nonBlankStringSchema.optional(),
    confidence: EvidenceConfidenceSchema,
  })
  .strict();

export const PageQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().nonnegative(),
  })
  .strict();

export const SearchResultSchema = z
  .object({
    entityType: z.enum(['document', 'job', 'evidence', 'analysis']),
    id: nonBlankStringSchema,
    title: nonBlankStringSchema,
    snippet: nonBlankStringSchema,
    rank: z.number().finite(),
  })
  .strict();

export const AnalysisHistoryItemSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    id: nonBlankStringSchema,
    profileId: nonBlankStringSchema.optional(),
    resumeDocumentId: nonBlankStringSchema.optional(),
    jobId: nonBlankStringSchema.optional(),
    overallScore: z.number().finite().min(0).max(100),
    recommendation: RecommendationSchema,
    confidence: unitIntervalSchema,
    hasHardBlocker: z.boolean(),
    generatedAt: nonBlankStringSchema,
  })
  .strict();

export const ProfileCreateInputSchema = z.object({ name: nonBlankStringSchema }).strict();

const manualEvidenceFields = {
  category: z.enum(['skill', 'project', 'responsibility', 'achievement', 'domain', 'leadership']),
  name: nonBlankStringSchema,
  description: nonBlankStringSchema,
} as const;

export const EvidenceAddInputSchema = z
  .discriminatedUnion('mode', [
    z
      .object({
        mode: z.literal('resume'),
        profileId: nonBlankStringSchema,
        resume: nonBlankStringSchema,
      })
      .strict(),
    z
      .object({
        mode: z.literal('manual'),
        profileId: nonBlankStringSchema,
        ...manualEvidenceFields,
      })
      .strict(),
  ])
  .or(
    z.union([
      z.object({ profileId: nonBlankStringSchema, resume: nonBlankStringSchema }).strict(),
      z.object({ profileId: nonBlankStringSchema, ...manualEvidenceFields }).strict(),
    ]),
  );

export const EvidenceEditInputSchema = z
  .object({
    evidenceId: nonBlankStringSchema,
    category: manualEvidenceFields.category.optional(),
    name: nonBlankStringSchema.optional(),
    normalizedName: nonBlankStringSchema.optional(),
    description: nonBlankStringSchema.optional(),
    employer: nonBlankStringSchema.optional(),
    project: nonBlankStringSchema.optional(),
    startDate: nonBlankStringSchema.optional(),
    endDate: nonBlankStringSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'evidenceId'), {
    message: 'At least one mutable evidence field is required',
  });

export const EvidenceRemoveInputSchema = z.object({ evidenceId: nonBlankStringSchema }).strict();

const envelope = <T extends z.ZodType>(command: string, data: T) =>
  z.object({ schemaVersion: z.literal('1.0'), command: z.literal(command), data }).strict();

export const CommandEnvelopeSchema = z.union([
  envelope('init', z.object({ profile: CandidateProfileSchema }).strict()),
  envelope('profile.create', z.object({ profile: CandidateProfileSchema }).strict()),
  envelope(
    'profile.show',
    z
      .object({
        profile: CandidateProfileSchema,
        documents: z.array(StoredDocumentSchema),
        evidence: z.array(CareerEvidenceSchema),
      })
      .strict(),
  ),
  envelope(
    'profile.evidence.add',
    z.union([
      z
        .object({
          status: z.enum(['imported', 'duplicate']),
          document: StoredDocumentSchema,
          evidence: z.array(CareerEvidenceSchema),
        })
        .strict(),
      z
        .object({
          status: z.enum(['imported', 'duplicate']),
          document: StoredDocumentSchema,
          evidence: CareerEvidenceSchema,
        })
        .strict(),
    ]),
  ),
  envelope('profile.evidence.edit', z.object({ evidence: CareerEvidenceSchema }).strict()),
  envelope(
    'profile.evidence.remove',
    z.object({ evidenceId: nonBlankStringSchema, removed: z.boolean() }).strict(),
  ),
  envelope(
    'report.show',
    z
      .object({
        analysis: AnalysisResultSchema,
        evidenceReferences: z.array(EvidenceReferenceSchema),
      })
      .strict(),
  ),
  envelope('history', z.object({ history: z.array(AnalysisHistoryItemSchema) }).strict()),
  envelope('search', z.object({ results: z.array(SearchResultSchema) }).strict()),
  envelope(
    'data.purge',
    z
      .object({ databaseRemoved: z.boolean(), walRemoved: z.boolean(), shmRemoved: z.boolean() })
      .strict(),
  ),
]);

export type StoredDocument = z.infer<typeof StoredDocumentSchema>;
export type StoredJob = z.infer<typeof StoredJobSchema>;
export type DuplicateDocumentStatus = z.infer<typeof DuplicateDocumentStatusSchema>;
export type DuplicateDocumentResult = z.infer<typeof DuplicateDocumentResultSchema>;
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;
export type PageQuery = z.infer<typeof PageQuerySchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type AnalysisHistoryItem = z.infer<typeof AnalysisHistoryItemSchema>;
export type ProfileCreateInput = z.infer<typeof ProfileCreateInputSchema>;
export type EvidenceAddInput = z.infer<typeof EvidenceAddInputSchema>;
export type EvidenceEditInput = z.infer<typeof EvidenceEditInputSchema>;
export type EvidenceRemoveInput = z.infer<typeof EvidenceRemoveInputSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

import {
  AnalysisHistoryItemSchema,
  AnalysisResultSchema,
  EvidenceReferenceSchema,
  JobRequirementSchema,
  StoredJobSchema,
  StoredJobSourceSchema,
  type AnalysisHistoryItem,
  type AnalysisResult,
  type EvidenceReference,
  type JobRequirement,
  type StoredJob,
  type StoredJobSource,
} from '@roleproof/shared';

export type { AnalysisHistoryItem } from '@roleproof/shared';

import type { StorageDatabase } from './database.js';
import { StorageError } from './errors.js';
import type { AnalysisTable, JobRequirementTable, JobSourceTable, JobTable } from './schema.js';

type Clock = () => Date;
type CreateJob = Omit<StoredJob, 'createdAt' | 'updatedAt'>;
type CreateJobSource = Omit<StoredJobSource, 'createdAt' | 'updatedAt'>;

export interface StoredAnalysis {
  result: AnalysisResult;
  evidenceReferences: EvidenceReference[];
  report: string;
}

export interface JobRepository {
  save(job: CreateJob, requirements: JobRequirement[]): Promise<StoredJob>;
  get(id: string): Promise<StoredJob | undefined>;
  getRequirements(jobId: string): Promise<JobRequirement[]>;
  saveSource(source: CreateJobSource): Promise<StoredJobSource>;
  getSource(jobId: string): Promise<StoredJobSource | undefined>;
}

export interface AnalysisRepository {
  save(
    result: AnalysisResult,
    evidenceReferences: EvidenceReference[],
    report: string,
  ): Promise<StoredAnalysis>;
  get(id: string): Promise<StoredAnalysis | undefined>;
  listHistory(profileId?: string): Promise<AnalysisHistoryItem[]>;
  remove(id: string): Promise<boolean>;
}

function validate<T>(label: string, parse: () => T): T {
  try {
    return parse();
  } catch (cause) {
    throw new StorageError('VALIDATION_FAILED', `Invalid ${label}`, { cause });
  }
}

function fail(action: string, cause: unknown): never {
  if (cause instanceof StorageError) throw cause;
  throw new StorageError('REPOSITORY_FAILED', `Unable to ${action}`, { cause });
}

function toJob(row: JobTable): StoredJob {
  const parserOutput = JSON.parse(row.parser_output_json) as { warnings?: unknown };
  return StoredJobSchema.parse({
    schemaVersion: '1.0',
    id: row.id,
    format: row.format,
    contentSha256: row.content_sha256,
    parsedContentSha256: row.parsed_content_sha256,
    text: row.text,
    confidence: row.confidence,
    warnings: parserOutput.warnings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toRequirement(row: JobRequirementTable): JobRequirement {
  return JobRequirementSchema.parse({
    id: row.id,
    category: row.category,
    text: row.text,
    ...(row.normalized_name === null ? {} : { normalizedName: row.normalized_name }),
    importance: row.importance,
    ...(row.years_requested === null ? {} : { yearsRequested: row.years_requested }),
  });
}

function toJobSource(row: JobSourceTable): StoredJobSource {
  return StoredJobSourceSchema.parse({
    jobId: row.job_id,
    schemaVersion: '1.0',
    url: row.url,
    ...(row.final_url === null ? {} : { finalUrl: row.final_url }),
    retrievedAt: row.retrieved_at,
    ...(row.status_code === null ? {} : { statusCode: row.status_code }),
    ...(row.content_type === null ? {} : { contentType: row.content_type }),
    sourceClassification: row.source_classification,
    atsProvider: row.ats_provider,
    removedOrUnavailable: row.removed_or_unavailable === 1,
    confidence: row.confidence,
    warnings: JSON.parse(row.warnings_json) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toStoredAnalysis(row: AnalysisTable): StoredAnalysis {
  return {
    result: AnalysisResultSchema.parse(JSON.parse(row.result_json)),
    evidenceReferences: EvidenceReferenceSchema.array().parse(
      JSON.parse(row.evidence_references_json),
    ),
    report: row.report_text,
  };
}

function toHistory(row: AnalysisTable): AnalysisHistoryItem {
  return toAnalysisHistoryItem(AnalysisResultSchema.parse(JSON.parse(row.result_json)));
}

export function toAnalysisHistoryItem(result: AnalysisResult): AnalysisHistoryItem {
  return AnalysisHistoryItemSchema.parse({
    schemaVersion: result.schemaVersion,
    id: result.id,
    ...(result.profileId === undefined ? {} : { profileId: result.profileId }),
    ...(result.resumeDocumentId === undefined ? {} : { resumeDocumentId: result.resumeDocumentId }),
    ...(result.jobId === undefined ? {} : { jobId: result.jobId }),
    overallScore: result.overallScore,
    recommendation: result.recommendation,
    confidence: result.confidence,
    hasHardBlocker: result.hardBlockers.length > 0,
    generatedAt: result.generatedAt,
  });
}

export function createJobRepository(database: StorageDatabase, clock: Clock): JobRepository {
  const get = async (id: string): Promise<StoredJob | undefined> => {
    const row = await database
      .selectFrom('jobs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toJob(row);
  };

  return {
    async save(input, inputRequirements) {
      try {
        const timestamp = clock().toISOString();
        const job = validate('stored job', () =>
          StoredJobSchema.parse({ ...input, createdAt: timestamp, updatedAt: timestamp }),
        );
        const requirements = inputRequirements.map((requirement) =>
          validate('job requirement', () => JobRequirementSchema.parse(requirement)),
        );
        const duplicate = await database
          .selectFrom('jobs')
          .selectAll()
          .where((expression) =>
            expression.or([
              expression('id', '=', job.id),
              expression('content_sha256', '=', job.contentSha256),
              expression('parsed_content_sha256', '=', job.parsedContentSha256),
            ]),
          )
          .orderBy('id')
          .executeTakeFirst();
        if (duplicate !== undefined) return toJob(duplicate);

        await database.transaction().execute(async (transaction) => {
          await transaction
            .insertInto('jobs')
            .values({
              id: job.id,
              title: null,
              company: null,
              format: job.format,
              content_sha256: job.contentSha256,
              parsed_content_sha256: job.parsedContentSha256,
              text: job.text,
              parser_output_json: JSON.stringify({ warnings: job.warnings }),
              confidence: job.confidence,
              created_at: job.createdAt,
              updated_at: job.updatedAt,
            })
            .execute();
          for (const [position, requirement] of requirements.entries()) {
            await transaction
              .insertInto('job_requirements')
              .values({
                id: requirement.id,
                job_id: job.id,
                category: requirement.category,
                text: requirement.text,
                normalized_name: requirement.normalizedName ?? null,
                importance: requirement.importance,
                years_requested: requirement.yearsRequested ?? null,
                position,
                created_at: timestamp,
              })
              .execute();
          }
        });
        return job;
      } catch (cause) {
        fail('save job and requirements', cause);
      }
    },

    async get(id) {
      try {
        return await get(id);
      } catch (cause) {
        fail('get job', cause);
      }
    },

    async getRequirements(jobId) {
      try {
        const rows = await database
          .selectFrom('job_requirements')
          .selectAll()
          .where('job_id', '=', jobId)
          .orderBy('position')
          .orderBy('id')
          .execute();
        return rows.map(toRequirement);
      } catch (cause) {
        fail('get job requirements', cause);
      }
    },

    async saveSource(input) {
      try {
        const timestamp = clock().toISOString();
        const source = validate('job source', () =>
          StoredJobSourceSchema.parse({ ...input, createdAt: timestamp, updatedAt: timestamp }),
        );
        await database
          .insertInto('job_sources')
          .values({
            job_id: source.jobId,
            url: source.url,
            final_url: source.finalUrl ?? null,
            retrieved_at: source.retrievedAt,
            status_code: source.statusCode ?? null,
            content_type: source.contentType ?? null,
            source_classification: source.sourceClassification,
            ats_provider: source.atsProvider,
            removed_or_unavailable: source.removedOrUnavailable ? 1 : 0,
            confidence: source.confidence,
            warnings_json: JSON.stringify(source.warnings),
            created_at: source.createdAt,
            updated_at: source.updatedAt,
          })
          .onConflict((conflict) =>
            conflict.column('job_id').doUpdateSet({
              url: source.url,
              final_url: source.finalUrl ?? null,
              retrieved_at: source.retrievedAt,
              status_code: source.statusCode ?? null,
              content_type: source.contentType ?? null,
              source_classification: source.sourceClassification,
              ats_provider: source.atsProvider,
              removed_or_unavailable: source.removedOrUnavailable ? 1 : 0,
              confidence: source.confidence,
              warnings_json: JSON.stringify(source.warnings),
              updated_at: source.updatedAt,
            }),
          )
          .execute();
        return source;
      } catch (cause) {
        fail('save job source', cause);
      }
    },

    async getSource(jobId) {
      try {
        const row = await database
          .selectFrom('job_sources')
          .selectAll()
          .where('job_id', '=', jobId)
          .executeTakeFirst();
        return row === undefined ? undefined : toJobSource(row);
      } catch (cause) {
        fail('get job source', cause);
      }
    },
  };
}

export function createAnalysisRepository(
  database: StorageDatabase,
  clock: Clock,
): AnalysisRepository {
  return {
    async save(input, inputEvidenceReferences, report) {
      try {
        const result = validate('analysis result', () => AnalysisResultSchema.parse(input));
        const evidenceReferences = validate('analysis evidence references', () =>
          EvidenceReferenceSchema.array().parse(inputEvidenceReferences),
        );
        const referencedIds = new Set(evidenceReferences.map(({ evidenceId }) => evidenceId));
        const citedIds = [
          ...result.matchedRequirements,
          ...result.unsupportedClaims,
          ...result.suggestedEmphasis,
          ...result.suggestedAdditions,
          ...(result.scoreContributions ?? []),
        ].flatMap(({ evidenceIds }) => evidenceIds);
        if (citedIds.some((id) => !referencedIds.has(id))) {
          throw new StorageError(
            'VALIDATION_FAILED',
            'Analysis cites evidence absent from its evidence-reference snapshot',
          );
        }
        const citedIdSet = new Set(citedIds);
        if (
          referencedIds.size !== evidenceReferences.length ||
          referencedIds.size !== citedIdSet.size ||
          evidenceReferences.some(({ evidenceId }) => !citedIdSet.has(evidenceId))
        ) {
          throw new StorageError(
            'VALIDATION_FAILED',
            'Analysis evidence-reference snapshot must exactly match cited evidence',
          );
        }
        for (const reference of evidenceReferences) {
          let valid = false;
          if (reference.sourceType === 'career-evidence') {
            const source = await database
              .selectFrom('career_evidence')
              .select(['id', 'profile_id', 'source_document_id', 'source_text', 'confidence'])
              .where('id', '=', reference.sourceId)
              .executeTakeFirst();
            valid =
              source !== undefined &&
              reference.evidenceId === source.id &&
              (result.profileId === undefined || source.profile_id === result.profileId) &&
              reference.sourceDocumentId === source.source_document_id &&
              reference.sourceText === (source.source_text ?? undefined) &&
              reference.confidence === source.confidence;
          } else if (reference.sourceType === 'profile-fact') {
            valid =
              result.profileId !== undefined &&
              reference.sourceId === result.profileId &&
              reference.sourceDocumentId === undefined &&
              reference.sourceText === undefined &&
              reference.confidence === 'user-confirmed';
          } else {
            valid =
              result.resumeDocumentId !== undefined &&
              reference.sourceId === result.resumeDocumentId &&
              reference.sourceDocumentId === result.resumeDocumentId &&
              reference.confidence === 'explicit';
          }
          if (!valid) {
            throw new StorageError(
              'VALIDATION_FAILED',
              'Analysis evidence-reference provenance is invalid',
            );
          }
        }
        if (report.trim().length === 0) {
          throw new StorageError('VALIDATION_FAILED', 'Invalid analysis report');
        }
        const stored = { result, evidenceReferences, report };
        await database
          .insertInto('analyses')
          .values({
            id: result.id,
            schema_version: result.schemaVersion,
            profile_id: result.profileId ?? null,
            resume_document_id: result.resumeDocumentId ?? null,
            job_id: result.jobId ?? null,
            overall_score: result.overallScore,
            recommendation: result.recommendation,
            confidence: result.confidence,
            has_hard_blocker: result.hardBlockers.length > 0 ? 1 : 0,
            result_json: JSON.stringify(result),
            evidence_references_json: JSON.stringify(evidenceReferences),
            report_text: report,
            generated_at: result.generatedAt,
            created_at: clock().toISOString(),
          })
          .execute();
        return stored;
      } catch (cause) {
        fail('save analysis', cause);
      }
    },

    async get(id) {
      try {
        const row = await database
          .selectFrom('analyses')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        return row === undefined ? undefined : toStoredAnalysis(row);
      } catch (cause) {
        fail('get analysis', cause);
      }
    },

    async listHistory(profileId) {
      try {
        let query = database.selectFrom('analyses').selectAll();
        if (profileId !== undefined) query = query.where('profile_id', '=', profileId);
        const rows = await query.orderBy('generated_at', 'desc').orderBy('id').execute();
        return rows.map(toHistory);
      } catch (cause) {
        fail('list analysis history', cause);
      }
    },

    async remove(id) {
      try {
        const row = await database
          .selectFrom('analyses')
          .select(['id', 'job_id'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (row === undefined) return false;
        await database.transaction().execute(async (transaction) => {
          await transaction.deleteFrom('analyses').where('id', '=', id).execute();
          if (row.job_id !== null) {
            const remaining = await transaction
              .selectFrom('analyses')
              .select('id')
              .where('job_id', '=', row.job_id)
              .executeTakeFirst();
            if (remaining === undefined) {
              await transaction.deleteFrom('jobs').where('id', '=', row.job_id).execute();
            }
          }
        });
        return true;
      } catch (cause) {
        fail('remove analysis', cause);
      }
    },
  };
}

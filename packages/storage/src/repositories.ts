import {
  CandidateProfileSchema,
  CareerEvidenceSchema,
  DuplicateDocumentResultSchema,
  StoredDocumentSchema,
  type CandidateProfile,
  type CareerEvidence,
  type DuplicateDocumentResult,
  type StoredDocument,
} from '@roleproof/shared';
import type { Kysely, Transaction } from 'kysely';

import type { StorageDatabase } from './database.js';
import { StorageError } from './errors.js';
import {
  createAnalysisRepository,
  createJobRepository,
  type AnalysisRepository,
  type JobRepository,
} from './remaining-repositories.js';
import { createSearchRepository, type SearchRepository } from './search.js';
import type { CareerEvidenceTable, DocumentTable, ProfileTable, StorageSchema } from './schema.js';
import {
  createAIRepositories,
  type AIEnhancementRepository,
  type ProviderCallRepository,
} from './ai-repositories.js';
import { createSettingsRepository, type SettingsRepository } from './settings-repository.js';

export const DEFAULT_PROFILE_ID = 'profile-local';

type Clock = () => Date;
type CreateProfile = Omit<CandidateProfile, 'createdAt' | 'updatedAt'>;
type UpdateProfile = Partial<Omit<CreateProfile, 'id'>>;
type CreateDocument = Omit<StoredDocument, 'createdAt' | 'updatedAt'>;
type EvidenceUpdate = Partial<
  Pick<
    CareerEvidence,
    | 'category'
    | 'name'
    | 'normalizedName'
    | 'description'
    | 'employer'
    | 'project'
    | 'startDate'
    | 'endDate'
  >
>;
type DatabaseExecutor = Kysely<StorageSchema> | Transaction<StorageSchema>;

export interface ProfileRepository {
  ensureDefault(): Promise<CandidateProfile>;
  create(profile: CreateProfile): Promise<CandidateProfile>;
  get(id: string): Promise<CandidateProfile | undefined>;
  list(): Promise<CandidateProfile[]>;
  update(id: string, update: UpdateProfile): Promise<CandidateProfile>;
}

export interface DocumentRepository {
  find(profileId: string, id: string): Promise<StoredDocument | undefined>;
  get(id: string): Promise<StoredDocument | undefined>;
  listByProfile(profileId: string): Promise<StoredDocument[]>;
  findDuplicate(
    profileId: string,
    contentSha256: string,
    parsedContentSha256: string,
  ): Promise<DuplicateDocumentResult>;
  insert(document: CreateDocument, evidence: CareerEvidence[]): Promise<DuplicateDocumentResult>;
}

export interface CareerEvidenceRepository {
  get(id: string): Promise<CareerEvidence | undefined>;
  listByProfile(profileId: string): Promise<CareerEvidence[]>;
  listByDocument(sourceDocumentId: string): Promise<CareerEvidence[]>;
  add(evidence: CareerEvidence): Promise<CareerEvidence>;
  edit(id: string, update: EvidenceUpdate): Promise<CareerEvidence>;
  remove(id: string): Promise<boolean>;
}

export interface RoleProofRepositories {
  profiles: ProfileRepository;
  documents: DocumentRepository;
  evidence: CareerEvidenceRepository;
  jobs: JobRepository;
  jobSources: Pick<JobRepository, 'saveSource' | 'getSource'>;
  analyses: AnalysisRepository;
  search: SearchRepository;
  settings: SettingsRepository;
  aiEnhancements: AIEnhancementRepository;
  providerCalls: ProviderCallRepository;
}

function timestamp(clock: Clock): string {
  return clock().toISOString();
}

function toProfile(row: ProfileTable): CandidateProfile {
  return CandidateProfileSchema.parse({
    id: row.id,
    ...(row.name === null ? {} : { name: row.name }),
    targetTitles: JSON.parse(row.target_titles_json) as unknown,
    preferredLocations: JSON.parse(row.preferred_locations_json) as unknown,
    ...(row.remote_preference === null ? {} : { remotePreference: row.remote_preference }),
    ...(row.target_salary_min === null ? {} : { targetSalaryMin: row.target_salary_min }),
    ...(row.target_salary_max === null ? {} : { targetSalaryMax: row.target_salary_max }),
    ...(row.work_authorization === null ? {} : { workAuthorization: row.work_authorization }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toDocument(row: DocumentTable): StoredDocument {
  const parserOutput = JSON.parse(row.parser_output_json) as { warnings?: unknown };
  return StoredDocumentSchema.parse({
    schemaVersion: '1.0',
    id: row.id,
    profileId: row.profile_id,
    kind: row.kind,
    format: row.format,
    ...(row.original_name === null ? {} : { originalName: row.original_name }),
    contentSha256: row.content_sha256,
    parsedContentSha256: row.parsed_content_sha256,
    text: row.text,
    confidence: row.confidence,
    warnings: parserOutput.warnings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toEvidence(row: CareerEvidenceTable): CareerEvidence {
  return CareerEvidenceSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    category: row.category,
    name: row.name,
    ...(row.normalized_name === null ? {} : { normalizedName: row.normalized_name }),
    description: row.description,
    ...(row.employer === null ? {} : { employer: row.employer }),
    ...(row.project === null ? {} : { project: row.project }),
    ...(row.start_date === null ? {} : { startDate: row.start_date }),
    ...(row.end_date === null ? {} : { endDate: row.end_date }),
    sourceDocumentId: row.source_document_id,
    ...(row.source_text === null ? {} : { sourceText: row.source_text }),
    confidence: row.confidence,
  });
}

function fail(action: string, cause: unknown): never {
  if (cause instanceof StorageError) {
    throw cause;
  }
  throw new StorageError('REPOSITORY_FAILED', `Unable to ${action}`, { cause });
}

function validate<T>(action: string, parse: () => T): T {
  try {
    return parse();
  } catch (cause) {
    throw new StorageError('VALIDATION_FAILED', `Invalid ${action}`, { cause });
  }
}

function profileInsert(profile: CandidateProfile) {
  return {
    id: profile.id,
    name: profile.name ?? null,
    target_titles_json: JSON.stringify(profile.targetTitles),
    preferred_locations_json: JSON.stringify(profile.preferredLocations),
    remote_preference: profile.remotePreference ?? null,
    target_salary_min: profile.targetSalaryMin ?? null,
    target_salary_max: profile.targetSalaryMax ?? null,
    work_authorization: profile.workAuthorization ?? null,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };
}

function documentInsert(document: StoredDocument) {
  return {
    id: document.id,
    profile_id: document.profileId,
    kind: document.kind,
    format: document.format,
    original_name: document.originalName ?? null,
    content_sha256: document.contentSha256,
    parsed_content_sha256: document.parsedContentSha256,
    text: document.text,
    parser_output_json: JSON.stringify({ warnings: document.warnings }),
    confidence: document.confidence,
    created_at: document.createdAt,
    updated_at: document.updatedAt,
  };
}

function evidenceInsert(evidence: CareerEvidence, createdAt: string) {
  return {
    id: evidence.id,
    profile_id: evidence.profileId,
    category: evidence.category,
    name: evidence.name,
    normalized_name: evidence.normalizedName ?? null,
    description: evidence.description,
    employer: evidence.employer ?? null,
    project: evidence.project ?? null,
    start_date: evidence.startDate ?? null,
    end_date: evidence.endDate ?? null,
    source_document_id: evidence.sourceDocumentId,
    source_text: evidence.sourceText ?? null,
    confidence: evidence.confidence,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

async function assertEvidenceOwnership(
  executor: DatabaseExecutor,
  evidence: CareerEvidence,
): Promise<void> {
  const source = await executor
    .selectFrom('documents')
    .select('profile_id')
    .where('id', '=', evidence.sourceDocumentId)
    .executeTakeFirst();
  if (source === undefined || source.profile_id !== evidence.profileId) {
    throw new StorageError(
      'VALIDATION_FAILED',
      'Evidence source document must belong to its profile',
    );
  }
}

async function addEvidence(
  executor: DatabaseExecutor,
  value: CareerEvidence,
  createdAt: string,
): Promise<CareerEvidence> {
  const evidence = validate('career evidence', () => CareerEvidenceSchema.parse(value));
  await assertEvidenceOwnership(executor, evidence);
  await executor
    .insertInto('career_evidence')
    .values(evidenceInsert(evidence, createdAt))
    .execute();
  return evidence;
}

export function createRoleProofRepositories(
  database: StorageDatabase,
  clock: Clock = () => new Date(),
): RoleProofRepositories {
  const profiles: ProfileRepository = {
    async ensureDefault() {
      try {
        const existing = await profiles.get(DEFAULT_PROFILE_ID);
        if (existing !== undefined) return existing;
        const now = timestamp(clock);
        const value = validate('candidate profile', () =>
          CandidateProfileSchema.parse({
            id: DEFAULT_PROFILE_ID,
            targetTitles: [],
            preferredLocations: [],
            createdAt: now,
            updatedAt: now,
          }),
        );
        await database
          .insertInto('profiles')
          .values(profileInsert(value))
          .onConflict((conflict) => conflict.column('id').doNothing())
          .execute();
        const stored = await profiles.get(DEFAULT_PROFILE_ID);
        if (stored === undefined) {
          throw new StorageError('REPOSITORY_FAILED', 'Unable to ensure default profile');
        }
        return stored;
      } catch (cause) {
        fail('ensure the default profile', cause);
      }
    },

    async create(input) {
      try {
        const now = timestamp(clock);
        const profile = validate('candidate profile', () =>
          CandidateProfileSchema.parse({ ...input, createdAt: now, updatedAt: now }),
        );
        await database.insertInto('profiles').values(profileInsert(profile)).execute();
        return profile;
      } catch (cause) {
        fail('create candidate profile', cause);
      }
    },

    async get(id) {
      try {
        const row = await database
          .selectFrom('profiles')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        return row === undefined ? undefined : toProfile(row);
      } catch (cause) {
        fail('get candidate profile', cause);
      }
    },

    async list() {
      try {
        const rows = await database.selectFrom('profiles').selectAll().orderBy('id').execute();
        return rows.map(toProfile);
      } catch (cause) {
        fail('list candidate profiles', cause);
      }
    },

    async update(id, update) {
      try {
        const current = await profiles.get(id);
        if (current === undefined) {
          throw new StorageError('NOT_FOUND', 'Candidate profile was not found');
        }
        const updatedAt = timestamp(clock);
        const value = validate('candidate profile update', () =>
          CandidateProfileSchema.parse({ ...current, ...update, updatedAt }),
        );
        await database
          .updateTable('profiles')
          .set({ ...profileInsert(value), id: undefined, created_at: undefined })
          .where('id', '=', id)
          .execute();
        return value;
      } catch (cause) {
        fail('update candidate profile', cause);
      }
    },
  };

  const getDocument = async (id: string): Promise<StoredDocument | undefined> => {
    const row = await database
      .selectFrom('documents')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toDocument(row);
  };

  const findDuplicate = async (
    profileId: string,
    contentSha256: string,
    parsedContentSha256: string,
  ): Promise<DuplicateDocumentResult> => {
    const exact = await database
      .selectFrom('documents')
      .selectAll()
      .where('profile_id', '=', profileId)
      .where('content_sha256', '=', contentSha256)
      .orderBy('id')
      .executeTakeFirst();
    if (exact !== undefined) {
      return DuplicateDocumentResultSchema.parse({ status: 'exact', document: toDocument(exact) });
    }
    const sameContent = await database
      .selectFrom('documents')
      .selectAll()
      .where('profile_id', '=', profileId)
      .where('parsed_content_sha256', '=', parsedContentSha256)
      .orderBy('id')
      .executeTakeFirst();
    return DuplicateDocumentResultSchema.parse(
      sameContent === undefined
        ? { status: 'none' }
        : { status: 'same-parsed-content', document: toDocument(sameContent) },
    );
  };

  const documents: DocumentRepository = {
    async find(profileId, id) {
      try {
        const row = await database
          .selectFrom('documents')
          .selectAll()
          .where('profile_id', '=', profileId)
          .where('id', '=', id)
          .executeTakeFirst();
        return row === undefined ? undefined : toDocument(row);
      } catch (cause) {
        fail('find profile document', cause);
      }
    },

    async get(id) {
      try {
        return await getDocument(id);
      } catch (cause) {
        fail('get document', cause);
      }
    },

    async listByProfile(profileId) {
      try {
        const rows = await database
          .selectFrom('documents')
          .selectAll()
          .where('profile_id', '=', profileId)
          .orderBy('id')
          .execute();
        return rows.map(toDocument);
      } catch (cause) {
        fail('list profile documents', cause);
      }
    },

    async findDuplicate(profileId, contentSha256, parsedContentSha256) {
      try {
        return await findDuplicate(profileId, contentSha256, parsedContentSha256);
      } catch (cause) {
        fail('classify duplicate document', cause);
      }
    },

    async insert(input, extractedEvidence) {
      try {
        const now = timestamp(clock);
        const document = validate('stored document', () =>
          StoredDocumentSchema.parse({ ...input, createdAt: now, updatedAt: now }),
        );
        const evidence = extractedEvidence.map((value) =>
          validate('career evidence', () => CareerEvidenceSchema.parse(value)),
        );
        for (const value of evidence) {
          if (value.profileId !== document.profileId || value.sourceDocumentId !== document.id) {
            throw new StorageError(
              'VALIDATION_FAILED',
              'Extracted evidence must belong to the inserted document and profile',
            );
          }
        }
        const duplicate = await findDuplicate(
          document.profileId,
          document.contentSha256,
          document.parsedContentSha256,
        );
        if (duplicate.status !== 'none') return duplicate;

        await database.transaction().execute(async (transaction) => {
          await transaction.insertInto('documents').values(documentInsert(document)).execute();
          for (const value of evidence) {
            await addEvidence(transaction, value, now);
          }
        });
        return DuplicateDocumentResultSchema.parse({ status: 'none' });
      } catch (cause) {
        fail('insert document and extracted evidence', cause);
      }
    },
  };

  const evidence: CareerEvidenceRepository = {
    async get(id) {
      try {
        const row = await database
          .selectFrom('career_evidence')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        return row === undefined ? undefined : toEvidence(row);
      } catch (cause) {
        fail('get career evidence', cause);
      }
    },

    async listByProfile(profileId) {
      try {
        const rows = await database
          .selectFrom('career_evidence')
          .selectAll()
          .where('profile_id', '=', profileId)
          .orderBy('id')
          .execute();
        return rows.map(toEvidence);
      } catch (cause) {
        fail('list profile career evidence', cause);
      }
    },

    async listByDocument(sourceDocumentId) {
      try {
        const rows = await database
          .selectFrom('career_evidence')
          .selectAll()
          .where('source_document_id', '=', sourceDocumentId)
          .orderBy('id')
          .execute();
        return rows.map(toEvidence);
      } catch (cause) {
        fail('list document career evidence', cause);
      }
    },

    async add(value) {
      try {
        return await addEvidence(database, value, timestamp(clock));
      } catch (cause) {
        fail('add career evidence', cause);
      }
    },

    async edit(id, update) {
      try {
        const current = await evidence.get(id);
        if (current === undefined) {
          throw new StorageError('NOT_FOUND', 'Career evidence was not found');
        }
        const value = validate('career evidence edit', () =>
          CareerEvidenceSchema.parse({
            ...current,
            category: update.category ?? current.category,
            name: update.name ?? current.name,
            normalizedName:
              'normalizedName' in update ? update.normalizedName : current.normalizedName,
            description: update.description ?? current.description,
            employer: 'employer' in update ? update.employer : current.employer,
            project: 'project' in update ? update.project : current.project,
            startDate: 'startDate' in update ? update.startDate : current.startDate,
            endDate: 'endDate' in update ? update.endDate : current.endDate,
            confidence: 'user-confirmed',
          }),
        );
        await database
          .updateTable('career_evidence')
          .set({
            category: value.category,
            name: value.name,
            normalized_name: value.normalizedName ?? null,
            description: value.description,
            employer: value.employer ?? null,
            project: value.project ?? null,
            start_date: value.startDate ?? null,
            end_date: value.endDate ?? null,
            confidence: 'user-confirmed',
            updated_at: timestamp(clock),
          })
          .where('id', '=', id)
          .execute();
        return value;
      } catch (cause) {
        fail('edit career evidence', cause);
      }
    },

    async remove(id) {
      try {
        const result = await database
          .deleteFrom('career_evidence')
          .where('id', '=', id)
          .executeTakeFirst();
        return result.numDeletedRows > 0n;
      } catch (cause) {
        fail('remove career evidence', cause);
      }
    },
  };

  const aiRepositories = createAIRepositories(database, clock);
  const jobs = createJobRepository(database, clock);
  return {
    profiles,
    documents,
    evidence,
    jobs,
    jobSources: {
      saveSource: (source) => jobs.saveSource(source),
      getSource: (jobId) => jobs.getSource(jobId),
    },
    analyses: createAnalysisRepository(database, clock),
    search: createSearchRepository(database),
    settings: createSettingsRepository(database, clock),
    ...aiRepositories,
  };
}

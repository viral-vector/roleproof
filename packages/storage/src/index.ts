export { closeStorage, openStorage, resolveDatabasePath, runMigrations } from './database.js';
export type { OpenStorageOptions, StorageDatabase } from './database.js';
export { StorageError } from './errors.js';
export type { StorageErrorCode } from './errors.js';
export { createRoleProofRepositories, DEFAULT_PROFILE_ID } from './repositories.js';
export type {
  AnalysisRepository,
  JobRepository,
  StoredAnalysis,
} from './remaining-repositories.js';
export type {
  CareerEvidenceRepository,
  DocumentRepository,
  ProfileRepository,
  RoleProofRepositories,
} from './repositories.js';
export { purgeStorage } from './purge.js';
export type { PurgeStorageResult } from './purge.js';
export { rebuildSearchIndexes } from './search.js';
export type { SearchRepository } from './search.js';
export type { StorageSchema } from './schema.js';

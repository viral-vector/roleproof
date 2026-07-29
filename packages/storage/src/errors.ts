export type StorageErrorCode =
  | 'INVALID_DATABASE_PATH'
  | 'OPEN_FAILED'
  | 'MIGRATION_FAILED'
  | 'CLOSE_FAILED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'REPOSITORY_FAILED'
  | 'SEARCH_FAILED'
  | 'PURGE_FAILED';

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
  }
}

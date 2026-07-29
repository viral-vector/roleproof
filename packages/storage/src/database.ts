import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { Migrator } from 'kysely/migration';

import { StorageError } from './errors.js';
import { migrationProvider } from './migrations/index.js';
import type { StorageSchema } from './schema.js';

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export type StorageDatabase = Kysely<StorageSchema>;

export interface OpenStorageOptions {
  path?: string;
  busyTimeoutMs?: number;
  readOnly?: boolean;
}

export function resolveDatabasePath(explicitPath?: string): string {
  if (explicitPath === undefined) {
    return join(homedir(), '.roleproof', 'roleproof.db');
  }
  if (explicitPath !== ':memory:' && !isAbsolute(explicitPath)) {
    throw new StorageError(
      'INVALID_DATABASE_PATH',
      `Explicit database path must be absolute: ${explicitPath}`,
    );
  }
  return explicitPath;
}

export async function runMigrations(database: StorageDatabase): Promise<void> {
  try {
    const result = await new Migrator({
      db: database,
      provider: migrationProvider,
    }).migrateToLatest();
    if (result.error !== undefined) {
      throw new StorageError('MIGRATION_FAILED', 'Unable to run storage migrations', {
        cause: result.error,
      });
    }
  } catch (cause) {
    if (cause instanceof StorageError) {
      throw cause;
    }
    throw new StorageError('MIGRATION_FAILED', 'Unable to run storage migrations', { cause });
  }
}

export async function openStorage(options: OpenStorageOptions = {}): Promise<StorageDatabase> {
  const path = resolveDatabasePath(options.path);
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const readOnly = options.readOnly ?? false;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new StorageError('OPEN_FAILED', 'busyTimeoutMs must be a non-negative safe integer');
  }

  if (path !== ':memory:' && !readOnly) {
    await mkdir(dirname(path), { recursive: true });
  }

  let sqlite: BetterSqlite3.Database | undefined;
  let database: StorageDatabase | undefined;
  try {
    sqlite = new BetterSqlite3(
      path,
      readOnly ? { fileMustExist: true, readonly: true } : undefined,
    );
    if (readOnly) sqlite.pragma('query_only = ON');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma(`busy_timeout = ${busyTimeoutMs}`);
    if (!readOnly) {
      sqlite.pragma('secure_delete = ON');
    }
    if (path !== ':memory:' && !readOnly) {
      sqlite.pragma('journal_mode = WAL');
    }

    database = new Kysely<StorageSchema>({
      dialect: new SqliteDialect({ database: sqlite }),
    });
    if (!readOnly) {
      await runMigrations(database);
    }
    return database;
  } catch (cause) {
    if (database !== undefined) {
      await database.destroy().catch(() => undefined);
    } else {
      sqlite?.close();
    }
    if (cause instanceof StorageError) {
      throw cause;
    }
    throw new StorageError('OPEN_FAILED', `Unable to open SQLite database at ${path}`, { cause });
  }
}

export async function closeStorage(database: StorageDatabase): Promise<void> {
  try {
    await database.destroy();
  } catch (cause) {
    throw new StorageError('CLOSE_FAILED', 'Unable to close SQLite database', { cause });
  }
}

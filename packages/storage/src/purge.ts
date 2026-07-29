import { access, unlink } from 'node:fs/promises';

import { resolveDatabasePath } from './database.js';
import { StorageError } from './errors.js';

export interface PurgeStorageResult {
  databaseRemoved: boolean;
  walRemoved: boolean;
  shmRemoved: boolean;
}

async function removeFile(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw cause;
  }
}

export async function purgeStorage(path?: string): Promise<PurgeStorageResult> {
  const databasePath = resolveDatabasePath(path);
  if (databasePath === ':memory:') {
    throw new StorageError('INVALID_DATABASE_PATH', 'In-memory storage cannot be purged');
  }
  try {
    // Delete the main database first so a locked Windows database cannot leave a partial purge.
    const databaseRemoved = await removeFile(databasePath);
    const walRemoved = await removeFile(`${databasePath}-wal`);
    const shmRemoved = await removeFile(`${databasePath}-shm`);
    for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      try {
        await access(candidate);
        throw new Error('Storage file still exists after purge');
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      }
    }
    return { databaseRemoved, walRemoved, shmRemoved };
  } catch (cause) {
    throw new StorageError('PURGE_FAILED', 'Unable to purge storage files', { cause });
  }
}

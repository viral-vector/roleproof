import type { Migration, MigrationProvider } from 'kysely/migration';

import { initialMigration } from './0001-initial.js';
import { aiPersistenceMigration } from './0002-ai-persistence.js';
import { docxFormatMigration } from './0003-docx-format.js';

const migrations: Readonly<Record<string, Migration>> = Object.freeze({
  '0001-initial': initialMigration,
  '0002-ai-persistence': aiPersistenceMigration,
  '0003-docx-format': docxFormatMigration,
});

export const migrationProvider: MigrationProvider = Object.freeze({
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve({ ...migrations });
  },
});

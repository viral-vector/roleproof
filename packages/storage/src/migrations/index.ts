import type { Migration, MigrationProvider } from 'kysely/migration';

import { initialMigration } from './0001-initial.js';

const migrations: Readonly<Record<string, Migration>> = Object.freeze({
  '0001-initial': initialMigration,
});

export const migrationProvider: MigrationProvider = Object.freeze({
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve({ ...migrations });
  },
});

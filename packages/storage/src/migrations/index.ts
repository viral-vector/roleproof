import type { Migration, MigrationProvider } from 'kysely/migration';

import { initialMigration } from './0001-initial.js';
import { aiPersistenceMigration } from './0002-ai-persistence.js';
import { docxFormatMigration } from './0003-docx-format.js';
import { webSettingsMigration } from './0004-web-settings.js';
import { providerSettingsAlignmentMigration } from './0005-provider-settings-alignment.js';
import { settingsCostRateRepairMigration } from './0006-settings-cost-rate-repair.js';
import { jobSourcesMigration } from './0007-job-sources.js';
import { atsProviderIcimsMigration } from './0008-ats-provider-icims.js';

const migrations: Readonly<Record<string, Migration>> = Object.freeze({
  '0001-initial': initialMigration,
  '0002-ai-persistence': aiPersistenceMigration,
  '0003-docx-format': docxFormatMigration,
  '0004-web-settings': webSettingsMigration,
  '0005-provider-settings-alignment': providerSettingsAlignmentMigration,
  '0006-settings-cost-rate-repair': settingsCostRateRepairMigration,
  '0007-job-sources': jobSourcesMigration,
  '0008-ats-provider-icims': atsProviderIcimsMigration,
});

export const migrationProvider: MigrationProvider = Object.freeze({
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve({ ...migrations });
  },
});

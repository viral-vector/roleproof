import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

export const settingsCostRateRepairMigration: Migration = Object.freeze({
  async up(database: Kysely<unknown>): Promise<void> {
    await sql`update settings
      set max_cost_usd = null
      where max_cost_usd is not null
        and (
          input_micro_usd_per_million_tokens is null
          or output_micro_usd_per_million_tokens is null
        )`.execute(database);
  },
  down(): Promise<void> {
    return Promise.reject(new Error('Migration 0006 does not support rollback'));
  },
});

import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

export const jobSourcesMigration: Migration = Object.freeze({
  async up(database: Kysely<unknown>): Promise<void> {
    await sql`create table job_sources (
      job_id text primary key references jobs(id) on delete cascade,
      url text not null,
      final_url text,
      retrieved_at text not null,
      status_code integer,
      content_type text,
      source_classification text not null check (
        source_classification in (
          'official-employer',
          'official-ats',
          'recruiter',
          'aggregator',
          'unknown',
          'removed-unavailable'
        )
      ),
      ats_provider text not null check (
        ats_provider in (
          'greenhouse',
          'lever',
          'workday',
          'ashby',
          'paylocity',
          'rippling',
          'jazzhr',
          'smartrecruiters',
          'unknown'
        )
      ),
      removed_or_unavailable integer not null check (removed_or_unavailable in (0, 1)),
      confidence real not null check (confidence >= 0 and confidence <= 1),
      warnings_json text not null default '[]' check (json_valid(warnings_json)),
      created_at text not null,
      updated_at text not null
    ) strict`.execute(database);
  },
  down(): Promise<void> {
    return Promise.reject(new Error('Migration 0007 does not support rollback'));
  },
});

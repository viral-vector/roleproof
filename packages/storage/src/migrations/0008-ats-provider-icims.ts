import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

export const atsProviderIcimsMigration: Migration = Object.freeze({
  async up(database: Kysely<unknown>): Promise<void> {
    await sql`create table job_sources_new (
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
          'icims',
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
    await sql`insert into job_sources_new (
      job_id,
      url,
      final_url,
      retrieved_at,
      status_code,
      content_type,
      source_classification,
      ats_provider,
      removed_or_unavailable,
      confidence,
      warnings_json,
      created_at,
      updated_at
    )
    select
      job_id,
      url,
      final_url,
      retrieved_at,
      status_code,
      content_type,
      source_classification,
      ats_provider,
      removed_or_unavailable,
      confidence,
      warnings_json,
      created_at,
      updated_at
    from job_sources`.execute(database);
    await sql`drop table job_sources`.execute(database);
    await sql`alter table job_sources_new rename to job_sources`.execute(database);
  },
  down(): Promise<void> {
    return Promise.reject(new Error('Migration 0008 does not support rollback'));
  },
});

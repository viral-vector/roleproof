import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

const createStatements = [
  `create table profiles (
    id text primary key,
    name text check (name is null or length(trim(name)) > 0),
    target_titles_json text not null default '[]' check (json_valid(target_titles_json)),
    preferred_locations_json text not null default '[]' check (json_valid(preferred_locations_json)),
    remote_preference text check (remote_preference in ('remote', 'hybrid', 'onsite', 'any')),
    target_salary_min real check (target_salary_min is null or target_salary_min >= 0),
    target_salary_max real check (target_salary_max is null or target_salary_max >= 0),
    work_authorization text,
    created_at text not null,
    updated_at text not null,
    check (target_salary_min is null or target_salary_max is null or target_salary_min <= target_salary_max)
  ) strict`,
  `create table documents (
    id text primary key,
    profile_id text not null references profiles(id) on delete cascade,
    kind text not null check (kind in ('resume', 'evidence-note')),
    format text not null check (format in ('plaintext', 'pdf')),
    original_name text,
    content_sha256 text not null check (length(content_sha256) = 64),
    parsed_content_sha256 text not null check (length(parsed_content_sha256) = 64),
    text text not null check (length(trim(text)) > 0),
    parser_output_json text not null check (json_valid(parser_output_json)),
    confidence real not null check (confidence >= 0 and confidence <= 1),
    created_at text not null,
    updated_at text not null,
    check (kind != 'evidence-note' or format = 'plaintext'),
    unique (profile_id, content_sha256)
  ) strict`,
  `create table career_evidence (
    id text primary key,
    profile_id text not null references profiles(id) on delete cascade,
    category text not null check (category in (
      'skill', 'project', 'responsibility', 'achievement', 'domain', 'leadership'
    )),
    name text not null check (length(trim(name)) > 0),
    normalized_name text,
    description text not null check (length(trim(description)) > 0),
    employer text,
    project text,
    start_date text,
    end_date text,
    source_document_id text not null references documents(id) on delete restrict,
    source_text text,
    confidence text not null check (confidence in ('explicit', 'inferred', 'user-confirmed')),
    created_at text not null,
    updated_at text not null
  ) strict`,
  `create table jobs (
    id text primary key,
    title text,
    company text,
    format text not null check (format = 'plaintext'),
    content_sha256 text not null unique check (length(content_sha256) = 64),
    parsed_content_sha256 text not null check (length(parsed_content_sha256) = 64),
    text text not null check (length(trim(text)) > 0),
    parser_output_json text not null check (json_valid(parser_output_json)),
    confidence real not null check (confidence >= 0 and confidence <= 1),
    created_at text not null,
    updated_at text not null
  ) strict`,
  `create table job_requirements (
    id text primary key,
    job_id text not null references jobs(id) on delete cascade,
    category text not null check (category in (
      'language', 'framework', 'database', 'infrastructure', 'domain', 'leadership',
      'education', 'location', 'authorization', 'clearance', 'license', 'other'
    )),
    text text not null check (length(trim(text)) > 0),
    normalized_name text,
    importance text not null check (importance in ('required', 'preferred', 'contextual')),
    years_requested real check (years_requested is null or years_requested >= 0),
    position integer not null check (position >= 0),
    created_at text not null,
    unique (job_id, position)
  ) strict`,
  `create table analyses (
    id text primary key,
    schema_version text not null,
    profile_id text references profiles(id) on delete set null,
    resume_document_id text references documents(id) on delete set null,
    job_id text references jobs(id) on delete set null,
    overall_score real not null check (overall_score >= 0 and overall_score <= 100),
    recommendation text not null check (recommendation in ('apply', 'stretch', 'skip', 'manual-review')),
    confidence real not null check (confidence >= 0 and confidence <= 1),
    has_hard_blocker integer not null check (has_hard_blocker in (0, 1)),
    result_json text not null check (json_valid(result_json)),
    evidence_references_json text not null check (json_valid(evidence_references_json)),
    report_text text not null,
    generated_at text not null,
    created_at text not null
  ) strict`,
  `create table provider_calls (
    id text primary key,
    analysis_id text references analyses(id) on delete cascade,
    provider text not null check (length(trim(provider)) > 0),
    model text,
    status text not null check (status in ('succeeded', 'failed')),
    created_at text not null
  ) strict`,
  `create table settings (
    id integer primary key check (id = 1),
    default_profile_id text references profiles(id) on delete set null,
    created_at text not null,
    updated_at text not null
  ) strict`,
  'create index documents_profile_id_idx on documents(profile_id)',
  'create index documents_parsed_hash_idx on documents(parsed_content_sha256)',
  'create index career_evidence_profile_id_idx on career_evidence(profile_id)',
  'create index career_evidence_source_document_id_idx on career_evidence(source_document_id)',
  'create index jobs_parsed_hash_idx on jobs(parsed_content_sha256)',
  'create index job_requirements_job_id_idx on job_requirements(job_id)',
  'create index analyses_profile_generated_idx on analyses(profile_id, generated_at desc)',
  'create index analyses_job_id_idx on analyses(job_id)',
  'create index provider_calls_analysis_id_idx on provider_calls(analysis_id)',
  `create virtual table documents_fts using fts5(
    id unindexed, text, content='documents', content_rowid='rowid'
  )`,
  `create virtual table jobs_fts using fts5(
    id unindexed, text, content='jobs', content_rowid='rowid'
  )`,
  `create virtual table career_evidence_fts using fts5(
    id unindexed, name, normalized_name, description, employer, project, source_text,
    content='career_evidence', content_rowid='rowid'
  )`,
  `create virtual table analyses_fts using fts5(
    id unindexed, report_text, content='analyses', content_rowid='rowid'
  )`,
  `create trigger documents_fts_ai after insert on documents begin
    insert into documents_fts(rowid, id, text) values (new.rowid, new.id, new.text);
  end`,
  `create trigger documents_fts_ad after delete on documents begin
    insert into documents_fts(documents_fts, rowid, id, text)
      values ('delete', old.rowid, old.id, old.text);
  end`,
  `create trigger documents_fts_au after update on documents begin
    insert into documents_fts(documents_fts, rowid, id, text)
      values ('delete', old.rowid, old.id, old.text);
    insert into documents_fts(rowid, id, text) values (new.rowid, new.id, new.text);
  end`,
  `create trigger jobs_fts_ai after insert on jobs begin
    insert into jobs_fts(rowid, id, text) values (new.rowid, new.id, new.text);
  end`,
  `create trigger jobs_fts_ad after delete on jobs begin
    insert into jobs_fts(jobs_fts, rowid, id, text) values ('delete', old.rowid, old.id, old.text);
  end`,
  `create trigger jobs_fts_au after update on jobs begin
    insert into jobs_fts(jobs_fts, rowid, id, text) values ('delete', old.rowid, old.id, old.text);
    insert into jobs_fts(rowid, id, text) values (new.rowid, new.id, new.text);
  end`,
  `create trigger career_evidence_fts_ai after insert on career_evidence begin
    insert into career_evidence_fts(
      rowid, id, name, normalized_name, description, employer, project, source_text
    ) values (
      new.rowid, new.id, new.name, new.normalized_name, new.description,
      new.employer, new.project, new.source_text
    );
  end`,
  `create trigger career_evidence_fts_ad after delete on career_evidence begin
    insert into career_evidence_fts(
      career_evidence_fts, rowid, id, name, normalized_name, description, employer, project, source_text
    ) values (
      'delete', old.rowid, old.id, old.name, old.normalized_name, old.description,
      old.employer, old.project, old.source_text
    );
  end`,
  `create trigger career_evidence_fts_au after update on career_evidence begin
    insert into career_evidence_fts(
      career_evidence_fts, rowid, id, name, normalized_name, description, employer, project, source_text
    ) values (
      'delete', old.rowid, old.id, old.name, old.normalized_name, old.description,
      old.employer, old.project, old.source_text
    );
    insert into career_evidence_fts(
      rowid, id, name, normalized_name, description, employer, project, source_text
    ) values (
      new.rowid, new.id, new.name, new.normalized_name, new.description,
      new.employer, new.project, new.source_text
    );
  end`,
  `create trigger analyses_fts_ai after insert on analyses begin
    insert into analyses_fts(rowid, id, report_text) values (new.rowid, new.id, new.report_text);
  end`,
  `create trigger analyses_fts_ad after delete on analyses begin
    insert into analyses_fts(analyses_fts, rowid, id, report_text)
      values ('delete', old.rowid, old.id, old.report_text);
  end`,
  `create trigger analyses_fts_au after update on analyses begin
    insert into analyses_fts(analyses_fts, rowid, id, report_text)
      values ('delete', old.rowid, old.id, old.report_text);
    insert into analyses_fts(rowid, id, report_text) values (new.rowid, new.id, new.report_text);
  end`,
] as const;

const dropStatements = [
  'drop table if exists analyses_fts',
  'drop table if exists career_evidence_fts',
  'drop table if exists jobs_fts',
  'drop table if exists documents_fts',
  'drop table if exists settings',
  'drop table if exists provider_calls',
  'drop table if exists analyses',
  'drop table if exists job_requirements',
  'drop table if exists jobs',
  'drop table if exists career_evidence',
  'drop table if exists documents',
  'drop table if exists profiles',
] as const;

export const initialMigration: Migration = Object.freeze({
  async up(database: Kysely<unknown>): Promise<void> {
    for (const statement of createStatements) {
      await sql.raw(statement).execute(database);
    }
  },
  async down(database: Kysely<unknown>): Promise<void> {
    for (const statement of dropStatements) {
      await sql.raw(statement).execute(database);
    }
  },
});

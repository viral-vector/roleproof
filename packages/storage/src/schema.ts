import type { Generated } from 'kysely';

interface TimestampedTable {
  created_at: string;
  updated_at: string;
}

export interface ProfileTable extends TimestampedTable {
  id: string;
  name: string | null;
  target_titles_json: string;
  preferred_locations_json: string;
  remote_preference: 'remote' | 'hybrid' | 'onsite' | 'any' | null;
  target_salary_min: number | null;
  target_salary_max: number | null;
  work_authorization: string | null;
}

export interface DocumentTable extends TimestampedTable {
  id: string;
  profile_id: string;
  kind: 'resume' | 'evidence-note';
  format: 'plaintext' | 'pdf' | 'docx';
  original_name: string | null;
  content_sha256: string;
  parsed_content_sha256: string;
  text: string;
  parser_output_json: string;
  confidence: number;
}

export interface CareerEvidenceTable extends TimestampedTable {
  id: string;
  profile_id: string;
  category: 'skill' | 'project' | 'responsibility' | 'achievement' | 'domain' | 'leadership';
  name: string;
  normalized_name: string | null;
  description: string;
  employer: string | null;
  project: string | null;
  start_date: string | null;
  end_date: string | null;
  source_document_id: string;
  source_text: string | null;
  confidence: 'explicit' | 'inferred' | 'user-confirmed';
}

export interface JobTable extends TimestampedTable {
  id: string;
  title: string | null;
  company: string | null;
  format: 'plaintext';
  content_sha256: string;
  parsed_content_sha256: string;
  text: string;
  parser_output_json: string;
  confidence: number;
}

export interface JobRequirementTable {
  id: string;
  job_id: string;
  category:
    | 'language'
    | 'framework'
    | 'database'
    | 'infrastructure'
    | 'domain'
    | 'leadership'
    | 'education'
    | 'location'
    | 'authorization'
    | 'clearance'
    | 'license'
    | 'other';
  text: string;
  normalized_name: string | null;
  importance: 'required' | 'preferred' | 'contextual';
  years_requested: number | null;
  position: number;
  created_at: string;
}

export interface AnalysisTable {
  id: string;
  schema_version: string;
  profile_id: string | null;
  resume_document_id: string | null;
  job_id: string | null;
  overall_score: number;
  recommendation: 'apply' | 'stretch' | 'skip' | 'manual-review';
  confidence: number;
  has_hard_blocker: 0 | 1;
  result_json: string;
  evidence_references_json: string;
  report_text: string;
  generated_at: string;
  created_at: string;
}

export interface ProviderCallTable {
  id: string;
  baseline_analysis_id: string | null;
  provider: string;
  model: string | null;
  operation:
    'analyze-requirements' | 'map-evidence' | 'suggest-application-changes' | 'health-check';
  destination: 'hosted' | 'local' | 'custom';
  endpoint_origin: string | null;
  status: 'succeeded' | 'failed';
  error_code:
    | 'auth'
    | 'rate-limit'
    | 'timeout'
    | 'unavailable'
    | 'refusal'
    | 'incomplete'
    | 'invalid-output'
    | 'budget-exceeded'
    | 'configuration'
    | null;
  redaction_applied: 0 | 1;
  redaction_categories_json: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_micro_usd: number | null;
  request_id: string | null;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  created_at: string;
}

export interface AIEnhancementTable {
  baseline_analysis_id: string;
  schema_version: string;
  config_fingerprint: string;
  enhancement_json: string;
  created_at: string;
}

export interface SettingsTable {
  id: 1;
  default_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

interface FtsTable {
  rowid: Generated<number>;
  id: string;
}

export interface StorageSchema {
  profiles: ProfileTable;
  documents: DocumentTable;
  career_evidence: CareerEvidenceTable;
  jobs: JobTable;
  job_requirements: JobRequirementTable;
  analyses: AnalysisTable;
  provider_calls: ProviderCallTable;
  ai_enhancements: AIEnhancementTable;
  settings: SettingsTable;
  documents_fts: FtsTable & { text: string };
  jobs_fts: FtsTable & { text: string };
  career_evidence_fts: FtsTable & {
    name: string;
    normalized_name: string | null;
    description: string;
    employer: string | null;
    project: string | null;
    source_text: string | null;
  };
  analyses_fts: FtsTable & { report_text: string };
}

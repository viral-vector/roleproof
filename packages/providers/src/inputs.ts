import {
  AnalysisResultSchema,
  ApplicationSuggestionInputSchema,
  CareerEvidenceSchema,
  EvidenceMappingInputSchema,
  JobRequirementSchema,
  MAX_PROVIDER_INPUT_ITEMS,
  ProviderConfigSchema,
  RequirementAnalysisInputSchema,
  type AnalysisResult,
  type ApplicationSuggestionInput,
  type CareerEvidence,
  type EvidenceMappingInput,
  type JobRequirement,
  type ProviderConfig,
  type RedactionConfig,
  type RequirementAnalysisInput,
} from '@roleproof/shared';

import { ProviderError } from './errors.js';

const MAX_COMPOSED_SUMMARY_CHARS = 20_000;
const MAX_EVIDENCE_SUMMARY_CHARS = 4_000;

export { MAX_PROVIDER_INPUT_ITEMS };

export const DEFAULT_PROVIDER_CONFIG = Object.freeze({
  requestTimeoutMs: 60_000,
  maxInputChars: 100_000,
  maxOutputTokens: 4_000,
  maxTotalTokens: 16_000,
  maxCostMicroUsd: null,
  rates: null,
  structuredOutputMode: 'json-schema',
  redaction: Object.freeze({
    email: true,
    phone: true,
    address: true,
    confidentialEmployerNames: false,
    clearanceDetails: false,
    userSelectedTerms: Object.freeze([] as string[]),
  }),
} as const);

export interface CreateProviderConfigInput {
  provider: ProviderConfig['provider'];
  model: string;
  destination: ProviderConfig['destination'];
  baseUrl?: string | null;
  requestTimeoutMs?: number;
  maxInputChars?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  maxCostMicroUsd?: number | null;
  rates?: ProviderConfig['rates'];
  structuredOutputMode?: ProviderConfig['structuredOutputMode'];
  redaction?: Partial<RedactionConfig>;
}

export const createProviderConfig = (input: CreateProviderConfigInput): ProviderConfig => {
  const redaction = {
    ...DEFAULT_PROVIDER_CONFIG.redaction,
    ...input.redaction,
    userSelectedTerms: [...(input.redaction?.userSelectedTerms ?? [])],
  };
  const candidate = {
    provider: input.provider,
    model: input.model,
    baseUrl:
      input.baseUrl === undefined || input.baseUrl === null
        ? null
        : new URL(input.baseUrl).toString().replace(/\/$/u, ''),
    destination: input.destination,
    requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_PROVIDER_CONFIG.requestTimeoutMs,
    maxInputChars: input.maxInputChars ?? DEFAULT_PROVIDER_CONFIG.maxInputChars,
    maxOutputTokens: input.maxOutputTokens ?? DEFAULT_PROVIDER_CONFIG.maxOutputTokens,
    maxTotalTokens: input.maxTotalTokens ?? DEFAULT_PROVIDER_CONFIG.maxTotalTokens,
    maxCostMicroUsd:
      input.maxCostMicroUsd === undefined
        ? DEFAULT_PROVIDER_CONFIG.maxCostMicroUsd
        : input.maxCostMicroUsd,
    rates: input.rates ?? DEFAULT_PROVIDER_CONFIG.rates,
    structuredOutputMode:
      input.structuredOutputMode ?? DEFAULT_PROVIDER_CONFIG.structuredOutputMode,
    redaction,
  };
  const parsed = ProviderConfigSchema.safeParse(candidate);
  if (!parsed.success) throw new ProviderError('configuration', 'health-check');
  return parsed.data;
};

export interface BuiltProviderInputs {
  requirementAnalysis: RequirementAnalysisInput;
  evidenceMapping: EvidenceMappingInput;
  applicationSuggestions: ApplicationSuggestionInput;
}

const failConfiguration = (): never => {
  throw new ProviderError('configuration', 'analyze-requirements');
};

const uniqueById = <T extends { id: string }>(items: readonly T[]): Map<string, T> => {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.id)) failConfiguration();
    result.set(item.id, item);
  }
  return result;
};

const boundedJoin = (values: readonly string[]): string => {
  const joined = values.join('\n');
  return joined.length <= MAX_COMPOSED_SUMMARY_CHARS
    ? joined
    : joined.slice(0, MAX_COMPOSED_SUMMARY_CHARS);
};

const evidenceSummary = (evidence: CareerEvidence): string => {
  const parts = [evidence.description, evidence.sourceText]
    .filter((value): value is string => value !== undefined)
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
  return parts.join(' ').slice(0, MAX_EVIDENCE_SUMMARY_CHARS);
};

export const buildProviderInputs = (
  baseline: AnalysisResult,
  requirements: readonly JobRequirement[],
  evidence: readonly CareerEvidence[],
): BuiltProviderInputs => {
  const parsedBaseline = AnalysisResultSchema.safeParse(baseline);
  const parsedRequirements = requirements.map((item) => JobRequirementSchema.safeParse(item));
  const parsedEvidence = evidence.map((item) => CareerEvidenceSchema.safeParse(item));
  if (
    !parsedBaseline.success ||
    parsedRequirements.some((item) => !item.success) ||
    parsedEvidence.some((item) => !item.success)
  ) {
    failConfiguration();
  }

  const requirementById = uniqueById(requirements);
  const evidenceById = uniqueById(evidence);
  const matchByRequirementId = new Map<string, AnalysisResult['matchedRequirements'][number]>();
  for (const match of baseline.matchedRequirements) {
    if (
      matchByRequirementId.has(match.requirementId) ||
      !requirementById.has(match.requirementId)
    ) {
      failConfiguration();
    }
    for (const evidenceId of match.evidenceIds) {
      if (!evidenceById.has(evidenceId)) failConfiguration();
    }
    matchByRequirementId.set(match.requirementId, match);
  }
  for (const requirement of requirements) {
    if (!matchByRequirementId.has(requirement.id)) failConfiguration();
  }

  const selectedRequirements = [...requirements]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .slice(0, MAX_PROVIDER_INPUT_ITEMS)
    .map((requirement) => {
      const match = matchByRequirementId.get(requirement.id);
      if (match === undefined) return failConfiguration();
      return {
        requirementId: requirement.id,
        text: requirement.text,
        importance: requirement.importance,
        baselineClassification: match.classification,
        evidenceIds: [...new Set(match.evidenceIds)].sort(),
      };
    });
  const selectedEvidenceIds = [
    ...new Set(selectedRequirements.flatMap((requirement) => requirement.evidenceIds)),
  ].sort();
  const selectedEvidence = selectedEvidenceIds.map((evidenceId) => {
    const item = evidenceById.get(evidenceId);
    if (item === undefined) return failConfiguration();
    return { evidenceId, redactedSummary: evidenceSummary(item) };
  });
  const jobSummary =
    boundedJoin(selectedRequirements.map((requirement) => requirement.text)) ||
    'No selected job requirements are available.';
  const resumeSummary =
    boundedJoin(selectedEvidence.map((item) => item.redactedSummary)) ||
    'No selected evidence is available.';

  try {
    return {
      requirementAnalysis: RequirementAnalysisInputSchema.parse({
        baselineAnalysisId: baseline.id,
        requirements: selectedRequirements,
        redactedJobSummary: jobSummary,
      }),
      evidenceMapping: EvidenceMappingInputSchema.parse({
        baselineAnalysisId: baseline.id,
        requirements: selectedRequirements,
        evidence: selectedEvidence,
      }),
      applicationSuggestions: ApplicationSuggestionInputSchema.parse({
        baselineAnalysisId: baseline.id,
        requirements: selectedRequirements,
        evidence: selectedEvidence,
        redactedResumeSummary: resumeSummary,
        redactedJobSummary: jobSummary,
      }),
    };
  } catch {
    return failConfiguration();
  }
};

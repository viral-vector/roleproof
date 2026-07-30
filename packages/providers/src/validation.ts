import {
  ApplicationSuggestionOutputSchema,
  EvidenceMappingOutputSchema,
  ProviderExecutionMetadataSchema,
  RequirementAnalysisOutputSchema,
  type ApplicationSuggestionInput,
  type ApplicationSuggestionOutput,
  type EvidenceMappingInput,
  type EvidenceMappingOutput,
  type ProviderConfig,
  type ProviderExecutionMetadata,
  type ProviderOperation,
  type ProviderRates,
  type RequirementAnalysisInput,
  type RequirementAnalysisOutput,
  type TransmissionManifest,
} from '@roleproof/shared';

import { ProviderError } from './errors.js';

export const calculateUsageCost = (
  rates: ProviderRates | null,
  usage: { readonly inputTokens: number | null; readonly outputTokens: number | null },
): number | null => {
  if (rates === null || usage.inputTokens === null || usage.outputTokens === null) return null;
  const numerator =
    BigInt(usage.inputTokens) * BigInt(rates.inputMicroUsdPerMillionTokens) +
    BigInt(usage.outputTokens) * BigInt(rates.outputMicroUsdPerMillionTokens);
  return Number((numerator + 500_000n) / 1_000_000n);
};

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();

const assertUniqueEntities = (values: readonly string[], operation: ProviderOperation): void => {
  if (new Set(values).size !== values.length) {
    throw new ProviderError('invalid-output', operation);
  }
};

const validateRequirementResults = (
  input: RequirementAnalysisInput | EvidenceMappingInput,
  output: RequirementAnalysisOutput | EvidenceMappingOutput,
  operation: 'analyze-requirements' | 'map-evidence',
): RequirementAnalysisOutput | EvidenceMappingOutput => {
  const results = 'requirements' in output ? output.requirements : output.mappings;
  const inputIds = input.requirements.map((item) => item.requirementId);
  assertUniqueEntities(inputIds, operation);
  assertUniqueEntities(
    results.map((item) => item.requirementId),
    operation,
  );
  const baseline = new Map(
    input.requirements.map((item) => [item.requirementId, item.baselineClassification]),
  );
  const evidenceIds = new Set(
    'evidence' in input
      ? input.evidence.map((item) => item.evidenceId)
      : input.requirements.flatMap((item) => item.evidenceIds),
  );
  if ('evidence' in input)
    assertUniqueEntities(
      input.evidence.map((item) => item.evidenceId),
      operation,
    );
  if (
    results.length !== inputIds.length ||
    results.some(
      (item) =>
        baseline.get(item.requirementId) !== item.baselineClassification ||
        item.evidenceIds.some((id) => !evidenceIds.has(id)),
    )
  ) {
    throw new ProviderError('invalid-output', operation);
  }
  const normalized = results
    .map((item) => ({ ...item, evidenceIds: sortedUnique(item.evidenceIds) }))
    .sort((left, right) => left.requirementId.localeCompare(right.requirementId));
  return 'requirements' in output ? { requirements: normalized } : { mappings: normalized };
};

export const validateRequirementAnalysis = (
  input: RequirementAnalysisInput,
  value: unknown,
): RequirementAnalysisOutput => {
  const parsed = RequirementAnalysisOutputSchema.safeParse(value);
  if (!parsed.success) throw new ProviderError('invalid-output', 'analyze-requirements');
  return validateRequirementResults(
    input,
    parsed.data,
    'analyze-requirements',
  ) as RequirementAnalysisOutput;
};

export const validateEvidenceMapping = (
  input: EvidenceMappingInput,
  value: unknown,
): EvidenceMappingOutput => {
  const parsed = EvidenceMappingOutputSchema.safeParse(value);
  if (!parsed.success) throw new ProviderError('invalid-output', 'map-evidence');
  return validateRequirementResults(input, parsed.data, 'map-evidence') as EvidenceMappingOutput;
};

export const validateApplicationSuggestions = (
  input: ApplicationSuggestionInput,
  value: unknown,
): ApplicationSuggestionOutput => {
  const operation = 'suggest-application-changes';
  const parsed = ApplicationSuggestionOutputSchema.safeParse(value);
  if (!parsed.success) throw new ProviderError('invalid-output', operation);
  assertUniqueEntities(
    input.evidence.map((item) => item.evidenceId),
    operation,
  );
  const knownEvidence = new Set(input.evidence.map((item) => item.evidenceId));
  const all = [
    ...parsed.data.suggestedEmphasis,
    ...parsed.data.suggestedAdditions,
    ...parsed.data.interviewTopics,
    ...parsed.data.coverLetterAngles,
  ];
  if (all.some((item) => item.evidenceIds.some((id) => !knownEvidence.has(id)))) {
    throw new ProviderError('invalid-output', operation);
  }
  const normalize = <T extends { evidenceIds: string[] }>(items: T[]): T[] =>
    items
      .map((item) => ({ ...item, evidenceIds: sortedUnique(item.evidenceIds) }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    suggestedEmphasis: normalize(parsed.data.suggestedEmphasis),
    suggestedAdditions: normalize(parsed.data.suggestedAdditions),
    interviewTopics: normalize(parsed.data.interviewTopics),
    coverLetterAngles: normalize(parsed.data.coverLetterAngles),
  };
};

export const validateExecutionMetadata = (
  config: Readonly<ProviderConfig>,
  operation: ProviderOperation,
  expectedManifest: Readonly<TransmissionManifest>,
  value: unknown,
): ProviderExecutionMetadata => {
  const parsed = ProviderExecutionMetadataSchema.safeParse(value);
  if (!parsed.success) throw new ProviderError('invalid-output', operation);
  const metadata = parsed.data;
  const computedCost = calculateUsageCost(config.rates, metadata.usage);
  if (
    metadata.operation !== operation ||
    metadata.provider !== config.provider ||
    metadata.model !== config.model ||
    metadata.destination !== config.destination ||
    metadata.manifest.provider !== config.provider ||
    metadata.manifest.model !== config.model ||
    metadata.manifest.destination !== config.destination ||
    JSON.stringify(metadata.manifest) !== JSON.stringify(expectedManifest) ||
    (operation !== 'health-check' &&
      (metadata.usage.inputTokens === null ||
        metadata.usage.outputTokens === null ||
        metadata.usage.totalTokens === null)) ||
    metadata.usage.costMicroUsd !== computedCost ||
    metadata.errorCode !== null
  ) {
    throw new ProviderError('invalid-output', operation);
  }
  return metadata;
};

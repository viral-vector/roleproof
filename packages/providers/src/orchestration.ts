import {
  AIEnhancementSchema,
  type AIEnhancement,
  type AnalysisResult,
  type ApplicationSuggestionInput,
  type EvidenceMappingInput,
  type ProviderExecutionMetadata,
  type ProviderOperation,
  type RequirementAnalysisInput,
} from '@roleproof/shared';

import { ProviderError, sanitizeProviderError } from './errors.js';
import { trustProviderCallContext } from './context.js';
import { buildTransmissionManifest, redactOperationInput } from './privacy.js';
import type {
  AIProvider,
  EnhancementFallbackResult,
  ProviderCallContext,
  ProviderResult,
} from './types.js';
import {
  validateApplicationSuggestions,
  validateEvidenceMapping,
  validateExecutionMetadata,
  validateRequirementAnalysis,
} from './validation.js';

const operationCategories = {
  'analyze-requirements': ['baseline-classification', 'job-summary', 'requirement-text'],
  'map-evidence': ['baseline-classification', 'evidence-summary', 'requirement-text'],
  'suggest-application-changes': [
    'baseline-classification',
    'evidence-summary',
    'job-summary',
    'requirement-text',
    'resume-summary',
  ],
} as const;

const deepFreeze = <T>(value: T): Readonly<T> => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

interface AggregateUsage {
  inputChars: number;
  totalTokens: number | null;
  costMicroUsd: number | null;
}

interface EnhancementAudit {
  completedExecutions: ProviderExecutionMetadata[];
  failureManifest?: Readonly<ReturnType<typeof buildTransmissionManifest>>;
  failedExecution?: ProviderExecutionMetadata;
}

const callWithTimeout = async <T>(
  operation: ProviderOperation,
  timeoutMs: number,
  call: () => Promise<T>,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      call(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProviderError('timeout', operation)), timeoutMs);
      }),
    ]);
  } catch (error) {
    throw sanitizeProviderError(error, operation);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const addUsage = (
  aggregate: AggregateUsage,
  metadata: ProviderExecutionMetadata,
): AggregateUsage => ({
  inputChars: aggregate.inputChars,
  totalTokens:
    aggregate.totalTokens === null || metadata.usage.totalTokens === null
      ? null
      : aggregate.totalTokens + metadata.usage.totalTokens,
  costMicroUsd:
    aggregate.costMicroUsd === null || metadata.usage.costMicroUsd === null
      ? null
      : aggregate.costMicroUsd + metadata.usage.costMicroUsd,
});

const enforceBudget = (
  provider: AIProvider,
  operation: ProviderOperation,
  aggregate: AggregateUsage,
): void => {
  const config = provider.config;
  if (
    aggregate.inputChars > config.maxInputChars ||
    (aggregate.totalTokens !== null && aggregate.totalTokens > config.maxTotalTokens) ||
    (config.maxCostMicroUsd !== null &&
      aggregate.costMicroUsd !== null &&
      aggregate.costMicroUsd > config.maxCostMicroUsd)
  ) {
    throw new ProviderError('budget-exceeded', operation);
  }
};

export const enhanceAnalysis = async (
  provider: AIProvider,
  requirementInput: RequirementAnalysisInput,
  evidenceInput: EvidenceMappingInput,
  suggestionInput: ApplicationSuggestionInput,
  confidentialEmployerNames: readonly string[] = [],
  audit: EnhancementAudit = { completedExecutions: [] },
): Promise<AIEnhancement> => {
  if (provider.id !== provider.config.provider) {
    throw new ProviderError('configuration', 'analyze-requirements');
  }
  if (
    requirementInput.baselineAnalysisId !== evidenceInput.baselineAnalysisId ||
    requirementInput.baselineAnalysisId !== suggestionInput.baselineAnalysisId ||
    JSON.stringify(requirementInput.requirements) !== JSON.stringify(evidenceInput.requirements) ||
    JSON.stringify(requirementInput.requirements) !==
      JSON.stringify(suggestionInput.requirements) ||
    JSON.stringify(evidenceInput.evidence) !== JSON.stringify(suggestionInput.evidence)
  ) {
    throw new ProviderError('configuration', 'analyze-requirements');
  }
  const executions = audit.completedExecutions;
  let aggregate: AggregateUsage = { inputChars: 0, totalTokens: 0, costMicroUsd: 0 };
  const invoke = async <T>(
    operation: ProviderOperation,
    manifest: ReturnType<typeof buildTransmissionManifest>,
    call: () => Promise<ProviderResult<T>>,
  ): Promise<ProviderResult<T>> => {
    audit.failureManifest = manifest;
    aggregate = {
      ...aggregate,
      inputChars: aggregate.inputChars + manifest.redactionSummary.outputChars,
    };
    enforceBudget(provider, operation, aggregate);
    const result = await callWithTimeout(operation, provider.config.requestTimeoutMs, call);
    const metadata = validateExecutionMetadata(
      provider.config,
      operation,
      manifest,
      result.metadata,
    );
    aggregate = addUsage(aggregate, metadata);
    audit.failedExecution = metadata;
    if (
      metadata.usage.outputTokens !== null &&
      metadata.usage.outputTokens > provider.config.maxOutputTokens
    ) {
      throw new ProviderError('budget-exceeded', operation);
    }
    enforceBudget(provider, operation, aggregate);
    return { output: result.output, metadata };
  };

  const prepare = <
    T extends RequirementAnalysisInput | EvidenceMappingInput | ApplicationSuggestionInput,
  >(
    operation: keyof typeof operationCategories,
    input: T,
  ): ProviderCallContext<T> => {
    const redacted = redactOperationInput(
      input,
      provider.config.redaction,
      confidentialEmployerNames,
    );
    const manifest = buildTransmissionManifest(
      provider.config,
      provider.endpointOrigin,
      operationCategories[operation],
      redacted.summary,
    );
    return trustProviderCallContext<T>(
      deepFreeze({ input: redacted.input, manifest }) as ProviderCallContext<T>,
    );
  };

  const requirementContext = prepare('analyze-requirements', requirementInput);
  const requirementResult = await invoke('analyze-requirements', requirementContext.manifest, () =>
    provider.analyzeRequirements(requirementContext),
  );
  const requirementAnalysis = validateRequirementAnalysis(
    requirementInput,
    requirementResult.output,
  );
  executions.push(requirementResult.metadata);
  delete audit.failedExecution;
  const evidenceContext = prepare('map-evidence', evidenceInput);
  const evidenceResult = await invoke('map-evidence', evidenceContext.manifest, () =>
    provider.mapEvidence(evidenceContext),
  );
  const evidenceMapping = validateEvidenceMapping(evidenceInput, evidenceResult.output);
  executions.push(evidenceResult.metadata);
  delete audit.failedExecution;
  const suggestionContext = prepare('suggest-application-changes', suggestionInput);
  const suggestionResult = await invoke(
    'suggest-application-changes',
    suggestionContext.manifest,
    () => provider.suggestApplicationChanges(suggestionContext),
  );
  const applicationSuggestions = validateApplicationSuggestions(
    suggestionInput,
    suggestionResult.output,
  );
  executions.push(suggestionResult.metadata);
  delete audit.failedExecution;

  return AIEnhancementSchema.parse({
    schemaVersion: '1.0',
    baselineAnalysisId: requirementInput.baselineAnalysisId,
    requirementAnalysis,
    evidenceMapping,
    applicationSuggestions,
    providerExecutions: executions,
  });
};

export const enhanceAnalysisWithFallback = async (
  baseline: AnalysisResult,
  provider: AIProvider,
  requirementInput: RequirementAnalysisInput,
  evidenceInput: EvidenceMappingInput,
  suggestionInput: ApplicationSuggestionInput,
  confidentialEmployerNames: readonly string[] = [],
): Promise<EnhancementFallbackResult> => {
  const audit: EnhancementAudit = { completedExecutions: [] };
  try {
    const enhancement = await enhanceAnalysis(
      provider,
      requirementInput,
      evidenceInput,
      suggestionInput,
      confidentialEmployerNames,
      audit,
    );
    return { baseline, enhancement };
  } catch (error) {
    return {
      baseline,
      error: sanitizeProviderError(error, 'analyze-requirements').toJSON(),
      completedExecutions: audit.completedExecutions,
      ...(audit.failedExecution === undefined ? {} : { failedExecution: audit.failedExecution }),
      ...(audit.failureManifest === undefined ? {} : { failureManifest: audit.failureManifest }),
    };
  }
};

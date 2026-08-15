import type {
  AIEnhancement,
  AnalysisResult,
  ApplicationSuggestionInput,
  ApplicationSuggestionOutput,
  EvidenceMappingInput,
  EvidenceMappingOutput,
  ProviderConfig,
  ProviderErrorCode,
  ProviderExecutionMetadata,
  ProviderHealth,
  ProviderId,
  LocalProviderModel,
  ProviderOperation,
  RequirementAnalysisInput,
  RequirementAnalysisOutput,
  TransmissionManifest,
} from '@roleproof/shared';

export interface ProviderResult<T> {
  readonly output: T;
  readonly metadata: ProviderExecutionMetadata;
}

export interface ProviderCallContext<T> {
  readonly input: Readonly<T>;
  readonly manifest: Readonly<TransmissionManifest>;
}

export interface AIProvider {
  readonly id: ProviderId;
  readonly config: Readonly<ProviderConfig>;
  readonly endpointOrigin: string;
  analyzeRequirements(
    context: ProviderCallContext<RequirementAnalysisInput>,
  ): Promise<ProviderResult<RequirementAnalysisOutput>>;
  mapEvidence(
    context: ProviderCallContext<EvidenceMappingInput>,
  ): Promise<ProviderResult<EvidenceMappingOutput>>;
  suggestApplicationChanges(
    context: ProviderCallContext<ApplicationSuggestionInput>,
  ): Promise<ProviderResult<ApplicationSuggestionOutput>>;
  healthCheck(): Promise<ProviderResult<ProviderHealth>>;
  listModels(): Promise<ProviderResult<{ models: readonly LocalProviderModel[] }>>;
}

export interface SanitizedProviderError {
  readonly name: 'ProviderError';
  readonly code: ProviderErrorCode;
  readonly operation: ProviderOperation;
  readonly message: string;
  readonly detail?: string;
}

export interface EnhancementFallbackResult {
  readonly baseline: AnalysisResult;
  readonly enhancement?: AIEnhancement;
  readonly error?: SanitizedProviderError;
  readonly completedExecutions?: readonly ProviderExecutionMetadata[];
  readonly failedExecution?: Readonly<ProviderExecutionMetadata>;
  readonly failureManifest?: Readonly<TransmissionManifest>;
}

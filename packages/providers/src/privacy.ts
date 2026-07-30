import {
  RedactionSummarySchema,
  TransmissionManifestSchema,
  type ApplicationSuggestionInput,
  type EvidenceMappingInput,
  type ProviderConfig,
  type RedactionCategory,
  type RedactionConfig,
  type RedactionSummary,
  type RequirementAnalysisInput,
  type TransmissionDataCategory,
  type TransmissionManifest,
} from '@roleproof/shared';

const CATEGORY_ORDER: readonly RedactionCategory[] = [
  'email',
  'phone',
  'address',
  'confidential-employer-name',
  'clearance-detail',
  'user-selected-term',
];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const placeholder = (category: RedactionCategory, index: number): string =>
  `[REDACTED_${category.replaceAll('-', '_').toUpperCase()}_${String(index)}]`;

export interface RedactedText {
  readonly text: string;
  readonly summary: RedactionSummary;
}

interface Rule {
  readonly category: RedactionCategory;
  readonly pattern: RegExp;
}

const literalRules = (category: RedactionCategory, values: readonly string[]): Rule[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map((value) => ({ category, pattern: new RegExp(escapeRegExp(value), 'giu') }));

export const redactText = (
  text: string,
  config: RedactionConfig,
  confidentialEmployerNames: readonly string[] = [],
): RedactedText => {
  const rules: Rule[] = [];
  if (config.email)
    rules.push({ category: 'email', pattern: /[\w.+-]+@[\w.-]+\.[A-Za-z]{1,63}/gu });
  if (config.phone) {
    rules.push({
      category: 'phone',
      pattern: /(?<!\w)\+?\d(?:[\s().-]*\d){7,14}(?!\w)/gu,
    });
  }
  if (config.address) {
    rules.push({
      category: 'address',
      pattern:
        /(?:\baddress\s*:\s*)?\b\d{1,6}\s+[A-Za-z][^\r\n,]{1,80}\b(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|court|ct|way)\b[^\r\n]*/giu,
    });
  }
  if (config.confidentialEmployerNames) {
    rules.push(...literalRules('confidential-employer-name', confidentialEmployerNames));
  }
  if (config.clearanceDetails) {
    rules.push({
      category: 'clearance-detail',
      pattern:
        /(?:\bclearance\s*:\s*[^\r\n]+|\b(?:active\s+)?(?:top\s+secret|secret|confidential|ts\/sci)(?:\s+clearance)?\b)/giu,
    });
  }
  rules.push(...literalRules('user-selected-term', config.userSelectedTerms));

  let redacted = text;
  const counts = new Map<RedactionCategory, number>();
  for (const rule of rules) {
    redacted = redacted.replace(rule.pattern, () => {
      const next = (counts.get(rule.category) ?? 0) + 1;
      counts.set(rule.category, next);
      return placeholder(rule.category, next);
    });
  }

  const summary = RedactionSummarySchema.parse({
    categories: CATEGORY_ORDER.filter((category) => counts.has(category)),
    replacementCount: [...counts.values()].reduce((total, count) => total + count, 0),
    inputChars: text.length,
    outputChars: redacted.length,
  });
  return { text: redacted, summary };
};

export interface ProviderInputs {
  readonly requirements: RequirementAnalysisInput;
  readonly evidence: EvidenceMappingInput;
  readonly suggestions: ApplicationSuggestionInput;
}

export interface RedactedProviderInputs extends ProviderInputs {
  readonly summary: RedactionSummary;
}

const combineSummaries = (summaries: readonly RedactionSummary[]): RedactionSummary =>
  RedactionSummarySchema.parse({
    categories: CATEGORY_ORDER.filter((category) =>
      summaries.some((summary) => summary.categories.includes(category)),
    ),
    replacementCount: summaries.reduce((total, item) => total + item.replacementCount, 0),
    inputChars: summaries.reduce((total, item) => total + item.inputChars, 0),
    outputChars: summaries.reduce((total, item) => total + item.outputChars, 0),
  });

export const redactOperationInput = <
  T extends RequirementAnalysisInput | EvidenceMappingInput | ApplicationSuggestionInput,
>(
  input: T,
  config: RedactionConfig,
  confidentialEmployerNames: readonly string[] = [],
): { readonly input: T; readonly summary: RedactionSummary } => {
  const summaries: RedactionSummary[] = [];
  const redact = (value: string): string => {
    const result = redactText(value, config, confidentialEmployerNames);
    summaries.push(result.summary);
    return result.text;
  };
  const result: Record<string, unknown> = {
    ...input,
    requirements: input.requirements.map((requirement) => ({
      ...requirement,
      text: redact(requirement.text),
    })),
  };
  if ('evidence' in input) {
    result.evidence = input.evidence.map((item) => ({
      ...item,
      redactedSummary: redact(item.redactedSummary),
    }));
  }
  if ('redactedResumeSummary' in input)
    result.redactedResumeSummary = redact(input.redactedResumeSummary);
  if ('redactedJobSummary' in input) result.redactedJobSummary = redact(input.redactedJobSummary);
  return { input: result as T, summary: combineSummaries(summaries) };
};

export const redactProviderInputs = (
  inputs: ProviderInputs,
  config: RedactionConfig,
  confidentialEmployerNames: readonly string[] = [],
): RedactedProviderInputs => {
  const summaries: RedactionSummary[] = [];
  const redact = (value: string): string => {
    const result = redactText(value, config, confidentialEmployerNames);
    summaries.push(result.summary);
    return result.text;
  };
  const redactRequirements = <T extends RequirementAnalysisInput | EvidenceMappingInput>(
    input: T,
  ): T =>
    ({
      ...input,
      requirements: input.requirements.map((requirement) => ({
        ...requirement,
        text: redact(requirement.text),
      })),
    }) as T;

  const requirements = {
    ...redactRequirements(inputs.requirements),
    redactedJobSummary: redact(inputs.requirements.redactedJobSummary),
  };
  const evidence = {
    ...redactRequirements(inputs.evidence),
    evidence: inputs.evidence.evidence.map((item) => ({
      ...item,
      redactedSummary: redact(item.redactedSummary),
    })),
  };
  const suggestions = {
    ...redactRequirements(inputs.suggestions),
    evidence: inputs.suggestions.evidence.map((item) => ({
      ...item,
      redactedSummary: redact(item.redactedSummary),
    })),
    redactedResumeSummary: redact(inputs.suggestions.redactedResumeSummary),
    redactedJobSummary: redact(inputs.suggestions.redactedJobSummary),
  };
  return {
    requirements,
    evidence,
    suggestions,
    summary: combineSummaries(summaries),
  };
};

export const buildTransmissionManifest = (
  config: ProviderConfig,
  endpoint: string,
  dataCategories: readonly TransmissionDataCategory[],
  redactionSummary: RedactionSummary,
): TransmissionManifest => {
  const endpointOrigin = new URL(endpoint).origin;
  return TransmissionManifestSchema.parse({
    provider: config.provider,
    model: config.model,
    destination: config.destination,
    endpointOrigin,
    dataCategories: [...new Set(dataCategories)].sort(),
    redactionApplied: redactionSummary.replacementCount > 0,
    redactionSummary,
  });
};

import { createHash } from 'node:crypto';

import {
  AnalysisResultSchema,
  CandidateContextSchema,
  DeterministicAnalysisInputSchema,
  type CandidateContext,
  type DeterministicAnalysisInput,
  type Phase1AnalysisResult,
  type Suggestion,
  type UnsupportedClaim,
} from '@roleproof/shared';

import { detectHardBlockers } from './blockers.js';
import { DEFAULT_SCORING_CONFIG } from './config.js';
import { DEFAULT_NORMALIZATION_DATA } from './data.js';
import { extractCareerEvidence, extractJobRequirements } from './extraction.js';
import { matchEvidence } from './matching.js';
import { compareStableStrings } from './ordering.js';
import { recommendFromScore, scoreMatches } from './scoring.js';

export interface DeterministicAnalysisOptions {
  generatedAt?: string;
}

function stableAnalysisId(input: DeterministicAnalysisInput): string {
  const canonicalContext = {
    ...input.candidateContext,
    preferredLocations: [...input.candidateContext.preferredLocations].sort(),
    clearances: [...input.candidateContext.clearances].sort(),
    licenses: [...input.candidateContext.licenses].sort(),
    education: [...input.candidateContext.education].sort(),
    certifications: [...input.candidateContext.certifications].sort(),
  };
  const hash = createHash('sha256')
    .update(`${input.resume.id}\0${input.job.id}\0${JSON.stringify(canonicalContext)}`, 'utf8')
    .digest('hex');
  return `analysis-${hash.slice(0, 24)}`;
}

function valuesFromPrefixedLines(text: string, prefix: string): string[] {
  const expression = new RegExp(`^${prefix}\\s*:\\s*(.+)$`, 'gimu');
  return [...text.matchAll(expression)]
    .flatMap((match) => match[1]?.split(/[,;]/u) ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function mergeExplicitCandidateFacts(
  context: CandidateContext,
  resumeText: string,
): CandidateContext {
  const workAuthorization =
    context.workAuthorization ?? /^work authorization\s*:\s*(.+)$/imu.exec(resumeText)?.[1]?.trim();
  const resumeLocations = valuesFromPrefixedLines(resumeText, 'location');
  const resumeClearances = valuesFromPrefixedLines(resumeText, 'clearance');
  const resumeLicenses = valuesFromPrefixedLines(resumeText, 'licenses?');
  const resumeEducation = valuesFromPrefixedLines(resumeText, 'education');
  const resumeCertifications = valuesFromPrefixedLines(resumeText, 'certifications?');

  return CandidateContextSchema.parse({
    ...context,
    preferredLocations:
      context.preferredLocations.length > 0 ? context.preferredLocations : resumeLocations,
    ...(workAuthorization === undefined ? {} : { workAuthorization }),
    clearances: context.clearances.length > 0 ? context.clearances : resumeClearances,
    licenses: context.licenses.length > 0 ? context.licenses : resumeLicenses,
    education: context.education.length > 0 ? context.education : resumeEducation,
    certifications:
      context.certifications.length > 0 ? context.certifications : resumeCertifications,
  });
}

export function analyzeDeterministic(
  rawInput: DeterministicAnalysisInput,
  options: DeterministicAnalysisOptions = {},
): Phase1AnalysisResult {
  const input = DeterministicAnalysisInputSchema.parse(rawInput);
  const evidence = extractCareerEvidence(input.resume, DEFAULT_NORMALIZATION_DATA.aliases);
  const extraction = extractJobRequirements(input.job, DEFAULT_NORMALIZATION_DATA.aliases);
  const candidateContext = mergeExplicitCandidateFacts(input.candidateContext, input.resume.text);
  const matches = matchEvidence(
    extraction.requirements,
    evidence,
    DEFAULT_NORMALIZATION_DATA.relationships,
    candidateContext,
  );
  const hardBlockers = detectHardBlockers(input.job, candidateContext, extraction.requirements);
  const scoring = scoreMatches(extraction.requirements, matches, DEFAULT_SCORING_CONFIG);
  const confidence = Math.min(input.resume.confidence, input.job.confidence, extraction.confidence);
  const recommendation = recommendFromScore({
    score: scoring.overallScore,
    requirements: extraction.requirements,
    matches,
    confidence,
    hasConflicts: extraction.hasConflicts,
    hardBlockers,
    config: DEFAULT_SCORING_CONFIG,
  });

  const requirementById = new Map(
    extraction.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const missingRequirements = extraction.requirements.filter((requirement) => {
    const match = matches.find((candidate) => candidate.requirementId === requirement.id);
    return match === undefined || match.score === 0;
  });
  const unsupportedClaims: UnsupportedClaim[] = matches
    .filter((match) => match.classification === 'unsupported')
    .map((match) => {
      const requirement = requirementById.get(match.requirementId);
      const name = requirement?.normalizedName ?? requirement?.text ?? 'this requirement';
      return {
        text: `Do not claim direct ${name} experience.`,
        classification: 'unsupported',
        evidenceIds: [],
        explanation: match.explanation,
      };
    });
  const suggestedEmphasis: Suggestion[] = matches
    .filter((match) => match.score > 0)
    .map((match) => {
      const requirement = requirementById.get(match.requirementId);
      const name = requirement?.normalizedName ?? requirement?.text ?? 'the supported requirement';
      return {
        text: `Emphasize the cited evidence for ${name}.`,
        classification: match.classification,
        evidenceIds: match.evidenceIds,
        explanation: match.explanation,
      };
    });
  const suggestedAdditions: Suggestion[] = matches
    .filter((match) => {
      const requirement = requirementById.get(match.requirementId);
      return (
        requirement?.yearsRequested !== undefined && match.classification === 'partially-related'
      );
    })
    .map((match) => {
      const requirement = requirementById.get(match.requirementId);
      return {
        text: `Confirm the duration of ${requirement?.normalizedName ?? 'the cited experience'} before adding a years claim.`,
        classification: 'requires-user-confirmation',
        evidenceIds: match.evidenceIds,
        explanation: match.explanation,
      };
    });
  const interviewTopics = matches
    .filter((match) => match.score > 0)
    .map((match) => requirementById.get(match.requirementId)?.normalizedName)
    .filter((value): value is string => value !== undefined)
    .sort(compareStableStrings);
  const parserWarnings = [
    ...input.resume.warnings.map((warning) => warning.message),
    ...input.job.warnings.map((warning) => warning.message),
    ...extraction.warnings,
  ].sort(compareStableStrings);

  const parsed = AnalysisResultSchema.parse({
    schemaVersion: '1.0',
    id: stableAnalysisId(input),
    resumeDocumentId: input.resume.id,
    jobId: input.job.id,
    overallScore: scoring.overallScore,
    recommendation,
    confidence,
    hardBlockers,
    matchedRequirements: matches,
    missingRequirements,
    unsupportedClaims,
    suggestedEmphasis,
    suggestedAdditions,
    interviewTopics,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    metadata: {
      mode: 'deterministic',
      engineVersion: '0.1.0',
      normalizationVersion: '1.0.0',
      scoringVersion: DEFAULT_SCORING_CONFIG.version,
      parsing: {
        resumeConfidence: input.resume.confidence,
        jobConfidence: Math.min(input.job.confidence, extraction.confidence),
        warnings: parserWarnings,
      },
    },
    scoreContributions: scoring.contributions,
  });

  return {
    ...parsed,
    scoreContributions: parsed.scoreContributions ?? [],
  };
}

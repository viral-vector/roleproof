import { createHash } from 'node:crypto';

import {
  EvidenceMatchSchema,
  MATCH_VALUES,
  type CandidateContext,
  type CareerEvidence,
  type EvidenceMatch,
  type JobRequirement,
  type MatchClassification,
  type SkillRelationshipData,
} from '@roleproof/shared';

import { assessClearanceRequirement } from './blockers.js';
import { MAX_EVIDENCE_REFERENCES_PER_MATCH } from './config.js';
import { findSkillRelationship } from './normalization.js';
import { compareStableStrings } from './ordering.js';

function comparisonKey(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function containsPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = phrase.trim();
  return (
    normalizedPhrase.length > 1 &&
    new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegularExpression(normalizedPhrase)}(?![\\p{L}\\p{N}])`,
      'iu',
    ).test(text)
  );
}

function degreeLevel(text: string): string | undefined {
  return /\b(associate|bachelor|master|doctorate|doctoral|phd|ph\.d\.)\b/iu
    .exec(text)?.[1]
    ?.replace(/^doctoral$/iu, 'doctorate')
    .replace(/^ph\.?d\.?$/iu, 'doctorate')
    .toLocaleLowerCase('en-US');
}

function degreeField(text: string): string | undefined {
  return /\b(?:in|of)\s+(.+?)(?=\s+(?:is\s+)?(?:required|preferred|mandatory)\b|[.;]|$)/iu
    .exec(text)?.[1]
    ?.trim()
    .toLocaleLowerCase('en-US');
}

function requiredLocation(text: string): string | undefined {
  const value =
    /\b(?:on-site|onsite)\s+(?:work\s+)?(?:in|at)\s+(.+?)(?=\s+(?:is\s+)?required\b|[.;]|$)/iu.exec(
      text,
    )?.[1] ??
    /\bwork\s+(?:on-site|onsite)\s+(?:in|at)\s+(.+?)(?=\s+(?:is\s+)?required\b|[.;]|$)/iu.exec(
      text,
    )?.[1] ??
    /^(.+?)\s+location\s+(?:is\s+)?required\b/iu.exec(text)?.[1];
  return value?.trim().toLocaleLowerCase('en-US');
}

function workJurisdiction(text: string): string | undefined {
  const normalized = comparisonKey(text);
  if (/\b(?:united\s+states|u\.?s\.?|usa)\b/iu.test(normalized)) {
    return 'us';
  }
  if (/\bcanada\b/iu.test(normalized)) {
    return 'canada';
  }
  if (/\b(?:united\s+kingdom|u\.?k\.?)\b/iu.test(normalized)) {
    return 'uk';
  }
  return undefined;
}

function contextEvidenceId(category: string, value: string): string {
  const hash = createHash('sha256').update(`${category}\0${value}`, 'utf8').digest('hex');
  return `evidence-context-${hash.slice(0, 16)}`;
}

function supportingEligibilityValues(
  requirement: JobRequirement,
  context: CandidateContext,
): string[] {
  let values: string[] = [];
  switch (requirement.category) {
    case 'authorization':
      values = context.workAuthorization === undefined ? [] : [context.workAuthorization];
      break;
    case 'education':
      values = /\bcertification\b/iu.test(requirement.text)
        ? context.certifications
        : context.education;
      break;
    case 'license':
      values = context.licenses;
      break;
    case 'location':
      values = [...context.preferredLocations];
      if (context.remotePreference !== undefined) {
        values.push(context.remotePreference);
      }
      break;
    default:
      return [];
  }

  return values.filter((value) => {
    const valueKey = comparisonKey(value);
    if (valueKey === 'none' || valueKey.length < 2) {
      return false;
    }
    if (requirement.category === 'location' && valueKey === 'remote') {
      return /\bremote\b/iu.test(requirement.text);
    }
    if (requirement.category === 'location') {
      const location = requiredLocation(requirement.text);
      return (
        location !== undefined &&
        (valueKey === location ||
          valueKey.startsWith(`${location},`) ||
          location.startsWith(`${valueKey},`))
      );
    }
    if (requirement.category === 'authorization') {
      const requiresNoSponsorship = /\b(?:without|no)\s+(?:visa\s+)?sponsorship\b/iu.test(
        requirement.text,
      );
      const explicitlyUnauthorized =
        /\b(?:not(?:\s+currently)?|never)\s+authorized\b|\bunauthorized\b|\b(?:requires?|needs?)\s+sponsorship\b/iu.test(
          value,
        );
      const explicitlyAuthorized = /\bauthorized\b|\bcitizen\b|\bpermanent\s+resident\b/iu.test(
        value,
      );
      const requiredJurisdiction = workJurisdiction(requirement.text);
      const candidateJurisdiction = workJurisdiction(value);
      return (
        !explicitlyUnauthorized &&
        explicitlyAuthorized &&
        (requiredJurisdiction === undefined || candidateJurisdiction === requiredJurisdiction) &&
        (requiresNoSponsorship
          ? /\b(?:without|no)\s+(?:visa\s+)?sponsorship\b/iu.test(value)
          : containsPhrase(requirement.text, value))
      );
    }
    if (requirement.category === 'education' && /\bdegree\b/iu.test(requirement.text)) {
      const requiredLevel = degreeLevel(requirement.text);
      const requiredField = degreeField(requirement.text);
      return (
        requiredLevel !== undefined &&
        degreeLevel(value) === requiredLevel &&
        (requiredField === undefined || degreeField(value) === requiredField)
      );
    }
    if (requirement.category === 'license' && /^(?:license|licensed|none)$/iu.test(valueKey)) {
      return false;
    }
    return containsPhrase(requirement.text, value);
  });
}

function supportsRequestedDuration(evidence: CareerEvidence[], yearsRequested: number): boolean {
  return evidence.some((item) => {
    const startYear =
      item.startDate === undefined ? undefined : Number.parseInt(item.startDate, 10);
    const endYear = item.endDate === undefined ? undefined : Number.parseInt(item.endDate, 10);
    return (
      startYear !== undefined &&
      endYear !== undefined &&
      Number.isFinite(startYear) &&
      Number.isFinite(endYear) &&
      endYear >= startYear &&
      endYear - startYear > yearsRequested
    );
  });
}

function createMatch(
  requirement: JobRequirement,
  evidenceIds: string[],
  classification: MatchClassification,
  explanation: string,
): EvidenceMatch {
  return EvidenceMatchSchema.parse({
    requirementId: requirement.id,
    evidenceIds: [...evidenceIds].sort(),
    classification,
    score: MATCH_VALUES[classification],
    explanation,
  });
}

export function matchEvidence(
  requirements: JobRequirement[],
  evidence: CareerEvidence[],
  relationships: SkillRelationshipData,
  context?: CandidateContext,
): EvidenceMatch[] {
  const sortedEvidence = [...evidence].sort((left, right) =>
    compareStableStrings(left.id, right.id),
  );

  return [...requirements]
    .sort((left, right) => compareStableStrings(left.id, right.id))
    .map((requirement) => {
      if (requirement.category === 'clearance' && context !== undefined) {
        const assessment = assessClearanceRequirement(context.clearances, requirement.text);
        if (assessment.status === 'supported') {
          return createMatch(
            requirement,
            assessment.supportingValues.map((value) => contextEvidenceId('clearance', value)),
            'direct',
            'Explicit candidate clearance facts satisfy the required clearance.',
          );
        }
        if (assessment.status === 'mismatch') {
          return createMatch(
            requirement,
            [],
            'unsupported',
            'Explicit candidate clearance facts conflict with the required clearance.',
          );
        }
      }
      if (context !== undefined) {
        const supportingValues = supportingEligibilityValues(requirement, context);
        if (supportingValues.length > 0) {
          return createMatch(
            requirement,
            supportingValues.map((value) => contextEvidenceId(requirement.category, value)),
            'direct',
            `Explicit candidate facts satisfy the ${requirement.category} requirement.`,
          );
        }
      }

      const requirementName = requirement.normalizedName;
      if (requirementName === undefined) {
        return createMatch(
          requirement,
          [],
          'unknown',
          'The requirement could not be normalized safely.',
        );
      }

      const sameNameEvidence = sortedEvidence.filter((item) => {
        const evidenceName = item.normalizedName ?? item.name;
        return comparisonKey(evidenceName) === comparisonKey(requirementName);
      });
      const directEvidence = sameNameEvidence
        .filter((item) => item.confidence !== 'inferred')
        .slice(0, MAX_EVIDENCE_REFERENCES_PER_MATCH);
      if (directEvidence.length > 0) {
        if (
          requirement.yearsRequested !== undefined &&
          !supportsRequestedDuration(directEvidence, requirement.yearsRequested)
        ) {
          return createMatch(
            requirement,
            directEvidence.map((item) => item.id),
            'partially-related',
            `The skill is explicit, but the requested ${requirement.yearsRequested}-year duration requires confirmation.`,
          );
        }
        return createMatch(
          requirement,
          directEvidence.map((item) => item.id),
          'direct',
          `The supplied evidence explicitly supports ${requirementName}.`,
        );
      }
      const inferredDirectEvidence = sameNameEvidence
        .filter((item) => item.confidence === 'inferred')
        .slice(0, MAX_EVIDENCE_REFERENCES_PER_MATCH);
      if (inferredDirectEvidence.length > 0) {
        return createMatch(
          requirement,
          inferredDirectEvidence.map((item) => item.id),
          'requires-user-confirmation',
          `Inferred evidence names ${requirementName}, but direct experience requires user confirmation.`,
        );
      }

      const allRelatedEvidence = sortedEvidence
        .map((item) => ({
          evidence: item,
          classification: findSkillRelationship(
            item.normalizedName ?? item.name,
            requirementName,
            relationships,
          ),
        }))
        .filter(
          (
            candidate,
          ): candidate is {
            evidence: CareerEvidence;
            classification: 'partially-related' | 'strongly-related';
          } => candidate.classification !== undefined,
        );
      const relatedEvidence = allRelatedEvidence.filter(
        (candidate) => candidate.evidence.confidence !== 'inferred',
      );
      if (relatedEvidence.length > 0) {
        const configuredClassification = relatedEvidence.some(
          (candidate) => candidate.classification === 'strongly-related',
        )
          ? 'strongly-related'
          : 'partially-related';
        const supportingEvidence = relatedEvidence
          .filter((candidate) => candidate.classification === configuredClassification)
          .slice(0, MAX_EVIDENCE_REFERENCES_PER_MATCH);
        const durationUnverified =
          requirement.yearsRequested !== undefined &&
          !supportsRequestedDuration(
            supportingEvidence.map((candidate) => candidate.evidence),
            requirement.yearsRequested,
          );
        const classification = durationUnverified ? 'partially-related' : configuredClassification;
        const durationExplanation = durationUnverified
          ? ` The requested ${requirement.yearsRequested}-year duration requires confirmation.`
          : '';
        return createMatch(
          requirement,
          supportingEvidence.map((candidate) => candidate.evidence.id),
          classification,
          `${supportingEvidence.map((candidate) => candidate.evidence.name).join(', ')} is configured as ${configuredClassification} to ${requirementName}; it is not direct experience.${durationExplanation}`,
        );
      }
      const inferredRelatedEvidence = allRelatedEvidence
        .filter((candidate) => candidate.evidence.confidence === 'inferred')
        .slice(0, MAX_EVIDENCE_REFERENCES_PER_MATCH);
      if (inferredRelatedEvidence.length > 0) {
        return createMatch(
          requirement,
          inferredRelatedEvidence.map((candidate) => candidate.evidence.id),
          'requires-user-confirmation',
          `Inferred related evidence cannot support ${requirementName} without user confirmation.`,
        );
      }

      return createMatch(
        requirement,
        [],
        'unsupported',
        `No supplied evidence supports ${requirementName}.`,
      );
    });
}

import type { CandidateContext, JobRequirement, ParsedDocument } from '@roleproof/shared';

import { compareStableStrings } from './ordering.js';

function comparisonKey(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function isPreferred(line: string): boolean {
  return /\b(preferred|nice to have|bonus|a plus)\b/iu.test(line);
}

function isMandatory(line: string): boolean {
  const negated = /\b(?:no|not)\b.{0,40}\b(?:required|requires?|must|mandatory)\b/iu.test(line);
  return !negated && /\b(required|requires?|must|mandatory)\b/iu.test(line) && !isPreferred(line);
}

function listSupportsLine(values: string[], line: string): boolean {
  const normalizedLine = comparisonKey(line);
  return values.some((value) => {
    const key = comparisonKey(value);
    return (
      key !== 'none' &&
      key.length > 1 &&
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegularExpression(key)}(?![\\p{L}\\p{N}])`, 'iu').test(
        normalizedLine,
      )
    );
  });
}

function degreeRank(value: string): number | undefined {
  if (/\b(?:doctorate|doctoral|phd|ph\.d\.)\b/iu.test(value)) {
    return 4;
  }
  if (/\bmaster\b/iu.test(value)) {
    return 3;
  }
  if (/\bbachelor\b/iu.test(value)) {
    return 2;
  }
  if (/\bassociate\b/iu.test(value)) {
    return 1;
  }
  if (/\bhigh\s+school\b/iu.test(value)) {
    return 0;
  }
  return undefined;
}

function supportsDegreeRequirement(values: string[], line: string): boolean {
  if (/\bor\s+(?:equivalent|comparable)\s+experience\b/iu.test(line)) {
    return true;
  }
  const requiredRank = degreeRank(line);
  if (requiredRank === undefined) {
    return listSupportsLine(values, line);
  }
  return values.some((value) => (degreeRank(value) ?? -1) >= requiredRank);
}

function parseSalaryMaximums(text: string): number[] {
  const maximums: number[] = [];
  const expression =
    /(?:USD|\$)\s*([\d,.]+)\s*(k)?\s*(?:-|–|to)\s*(?:USD|\$)?\s*([\d,.]+)\s*(k)?/giu;
  for (const line of text.split('\n')) {
    const ranges = [...line.matchAll(expression)];
    let previousEnd = 0;
    for (const match of ranges) {
      const matchEnd = (match.index ?? 0) + match[0].length;
      const suffix = line.slice(matchEnd).split(/\s+(?:and|with|plus)\s+|[;,.]/iu, 1)[0];
      const rangeContext = `${line.slice(previousEnd, match.index)} ${suffix ?? ''}`;
      previousEnd = matchEnd;
      const isAnnual = /\b(?:annual|annually|yearly|per\s+year|a\s+year)\b|\/year\b/iu.test(
        rangeContext,
      );
      const isHourly = /\b(?:hourly|per\s+hour)\b|\/hour\b/iu.test(rangeContext);
      const isNonBasePay = /\b(?:bonus|commission|equity|stock|options?)\b/iu.test(rangeContext);
      if (!isAnnual || isHourly || isNonBasePay) {
        continue;
      }
      if (match[3] === undefined) {
        continue;
      }
      const minimum = Number.parseFloat(match[1]?.replaceAll(',', '') ?? 'NaN');
      const minimumMultiplier = match[2] === undefined ? 1 : 1_000;
      const maximum = Number.parseFloat(match[3].replaceAll(',', ''));
      const maximumMultiplier = match[4] === undefined ? 1 : 1_000;
      const normalizedMinimum = minimum * minimumMultiplier;
      const normalizedMaximum = maximum * maximumMultiplier;
      if (
        Number.isFinite(normalizedMinimum) &&
        Number.isFinite(normalizedMaximum) &&
        normalizedMinimum >= 0 &&
        normalizedMaximum >= normalizedMinimum
      ) {
        maximums.push(normalizedMaximum);
      }
    }
  }
  return maximums;
}

function clearanceLevels(value: string): string[] {
  return [
    ...comparisonKey(value).matchAll(/\b(top\s+secret|public\s+trust|secret|confidential)\b/gu),
  ]
    .map((match) => match[1]?.replace(/\s+/gu, ' '))
    .filter((level): level is string => level !== undefined);
}

export interface ClearanceAssessment {
  status: 'mismatch' | 'supported' | 'unknown';
  supportingValues: string[];
}

export function assessClearanceRequirement(
  values: string[],
  requirementLine: string,
): ClearanceAssessment {
  if (values.length === 0) {
    return { status: 'unknown', supportingValues: [] };
  }
  const requiredLevels = clearanceLevels(requirementLine);
  if (requiredLevels.length === 0) {
    const supportingValues = values.filter((value) => listSupportsLine([value], requirementLine));
    return {
      status: supportingValues.length > 0 ? 'supported' : 'unknown',
      supportingValues,
    };
  }
  const matchingValues = values.filter((value) =>
    clearanceLevels(value).some((level) => requiredLevels.includes(level)),
  );
  if (matchingValues.length === 0) {
    return { status: 'mismatch', supportingValues: [] };
  }
  const heldValues = matchingValues.filter(
    (value) =>
      !/^(?:\s*(?:no|without)\b|\s*does(?:\s+not|n't)\s+(?:hold|have)\b)|\bnot(?:\s+currently)?\s+(?:active|held)\b/iu.test(
        value,
      ) && !/\b(?:eligible|eligibility)\b/iu.test(value),
  );
  if (heldValues.length === 0) {
    const explicitlyNegated = matchingValues.some((value) =>
      /^(?:\s*(?:no|without)\b|\s*does(?:\s+not|n't)\s+(?:hold|have)\b)|\bnot(?:\s+currently)?\s+(?:active|held)\b/iu.test(
        value,
      ),
    );
    return {
      status: explicitlyNegated ? 'mismatch' : 'unknown',
      supportingValues: [],
    };
  }
  matchingValues.splice(0, matchingValues.length, ...heldValues);

  if (/\b(?:active|current)\b/iu.test(requirementLine)) {
    const activeValues = matchingValues.filter(
      (value) =>
        /\b(?:active|current)\b/iu.test(value) &&
        !/\b(?:former|inactive|expired|lapsed)\b/iu.test(value),
    );
    if (activeValues.length > 0) {
      matchingValues.splice(0, matchingValues.length, ...activeValues);
    } else if (
      matchingValues.every((value) => /\b(?:former|inactive|expired|lapsed)\b/iu.test(value))
    ) {
      return { status: 'mismatch', supportingValues: [] };
    } else {
      return { status: 'unknown', supportingValues: matchingValues };
    }
  }

  const requiredCompartments = ['sci', 'polygraph'].filter((compartment) =>
    new RegExp(`\\b${compartment}\\b`, 'iu').test(requirementLine),
  );
  for (const compartment of requiredCompartments) {
    const explicitMatches = matchingValues.filter((value) =>
      new RegExp(`\\b${compartment}\\b`, 'iu').test(value),
    );
    if (explicitMatches.length > 0) {
      const explicitlyExcluded = explicitMatches.every((value) =>
        new RegExp(`\\b(?:no|without)\\s+${compartment}\\b`, 'iu').test(value),
      );
      if (explicitlyExcluded) {
        return { status: 'mismatch', supportingValues: [] };
      }
      matchingValues.splice(0, matchingValues.length, ...explicitMatches);
    } else {
      return { status: 'unknown', supportingValues: matchingValues };
    }
  }

  return { status: 'supported', supportingValues: matchingValues };
}

export function requiresNoSponsorship(text: string): boolean {
  return (
    /\b(?:without|no)\s+(?:visa\s+)?sponsorship\b/iu.test(text) ||
    /\b(?:does\s+not|do\s+not|will\s+not|cannot|can't)\s+(?:offer|provide|support|sponsor)\b.{0,40}\bsponsorship\b/iu.test(
      text,
    ) ||
    /\bsponsorship\s+(?:is\s+)?not\s+(?:offered|available|provided|supported)\b/iu.test(text)
  );
}

function requiredLines(
  requirements: JobRequirement[],
  lines: string[],
  category: JobRequirement['category'],
  textPattern: RegExp | ((text: string) => boolean),
): string[] {
  const matchesPattern = (text: string): boolean =>
    textPattern instanceof RegExp ? textPattern.test(text) : textPattern(text);
  const structured = requirements
    .filter(
      (requirement) =>
        requirement.importance === 'required' &&
        requirement.category === category &&
        matchesPattern(requirement.text),
    )
    .map((requirement) => requirement.text);
  return structured.length > 0
    ? structured.sort(compareStableStrings)
    : lines.filter((line) => isMandatory(line) && matchesPattern(line)).sort();
}

function hasUnsupportedRequiredLine(
  required: string[],
  values: string[],
  supports: (values: string[], line: string) => boolean,
): boolean {
  return (
    values.length > 0 && required.some((requirementLine) => !supports(values, requirementLine))
  );
}

export function detectHardBlockers(
  job: ParsedDocument,
  context: CandidateContext,
  requirements: JobRequirement[] = [],
): string[] {
  const blockers: string[] = [];
  const lines = job.text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (
    context.workAuthorization !== undefined &&
    /\b(requires?|needs?)\s+sponsorship\b/iu.test(context.workAuthorization) &&
    requiredLines(requirements, lines, 'authorization', requiresNoSponsorship).length > 0
  ) {
    blockers.push('Work authorization mismatch: the role does not allow required sponsorship.');
  }

  const clearanceLines = requiredLines(requirements, lines, 'clearance', /\bclearance\b/iu);
  if (
    context.clearances.length > 0 &&
    clearanceLines.some(
      (clearanceLine) =>
        assessClearanceRequirement(context.clearances, clearanceLine).status === 'mismatch',
    )
  ) {
    blockers.push('Mandatory clearance mismatch: supplied clearance evidence does not match.');
  }

  const licenseLines = requiredLines(requirements, lines, 'license', /\blicen[cs]e\b/iu);
  if (hasUnsupportedRequiredLine(licenseLines, context.licenses, listSupportsLine)) {
    blockers.push('Mandatory license mismatch: supplied license evidence does not match.');
  }

  const degreeLines = requiredLines(requirements, lines, 'education', /\bdegree\b/iu);
  if (hasUnsupportedRequiredLine(degreeLines, context.education, supportsDegreeRequirement)) {
    blockers.push('Mandatory degree mismatch: supplied education evidence does not match.');
  }

  const certificationLines = requiredLines(requirements, lines, 'education', /\bcertification\b/iu);
  if (hasUnsupportedRequiredLine(certificationLines, context.certifications, listSupportsLine)) {
    blockers.push(
      'Mandatory certification mismatch: supplied certification evidence does not match.',
    );
  }

  const onsiteLines = requiredLines(requirements, lines, 'location', /\b(?:on-site|onsite)\b/iu);
  for (const onsiteLine of onsiteLines) {
    const requiredLocation =
      /\b(?:on-site|onsite)\s+(?:work\s+)?(?:in|at)\s+(.+?)(?=\s+(?:is\s+)?required\b|[.;]|$)/iu
        .exec(onsiteLine)?.[1]
        ?.trim() ??
      /\bwork\s+(?:on-site|onsite)\s+(?:in|at)\s+(.+?)(?=\s+(?:is\s+)?required\b|[.;]|$)/iu
        .exec(onsiteLine)?.[1]
        ?.trim();
    const explicitlyRemote = context.remotePreference === 'remote';
    const explicitLocationMismatch =
      requiredLocation !== undefined &&
      context.preferredLocations.length > 0 &&
      !context.preferredLocations.some((location) =>
        comparisonKey(location).includes(comparisonKey(requiredLocation)),
      );
    if (explicitlyRemote || explicitLocationMismatch) {
      blockers.push(
        `Explicit location mismatch: the role requires onsite work${requiredLocation === undefined ? '' : ` in ${requiredLocation}`}.`,
      );
      break;
    }
  }

  if (context.targetSalaryMin !== undefined) {
    const maximums = parseSalaryMaximums(job.text);
    if (maximums.length > 0) {
      const maximum = Math.max(...maximums);
      if (maximum < context.targetSalaryMin) {
        blockers.push(
          `Compensation maximum ${maximum} is below the candidate minimum ${context.targetSalaryMin}.`,
        );
      }
    }
  }

  return blockers.sort(compareStableStrings);
}

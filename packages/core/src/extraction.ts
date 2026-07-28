import { createHash } from 'node:crypto';

import {
  CareerEvidenceSchema,
  JobRequirementSchema,
  type CareerEvidence,
  type CareerEvidenceCategory,
  type JobRequirement,
  type JobRequirementCategory,
  type JobRequirementImportance,
  type ParsedDocument,
  type SkillAliasCategory,
  type SkillAliasData,
} from '@roleproof/shared';

import { MAX_ANALYZED_REQUIREMENTS } from './config.js';
import { extractSkillMentions } from './normalization.js';
import { compareStableStrings } from './ordering.js';

export interface RequirementExtractionResult {
  confidence: number;
  hasConflicts: boolean;
  requirements: JobRequirement[];
  warnings: string[];
}

function stableId(prefix: string, ...parts: string[]): string {
  const hash = createHash('sha256').update(parts.join('\0'), 'utf8').digest('hex');
  return `${prefix}-${hash.slice(0, 24)}`;
}

function evidenceCategory(category: SkillAliasCategory): CareerEvidenceCategory {
  if (category === 'leadership') {
    return 'leadership';
  }
  if (category === 'domain') {
    return 'domain';
  }
  if (category === 'other') {
    return 'responsibility';
  }
  return 'skill';
}

function requirementCategory(category: SkillAliasCategory): JobRequirementCategory {
  return category === 'other' ? 'other' : category;
}

function extractDateRange(
  line: string,
  mentionIndex: number,
  mentionLength: number,
): { endDate?: string; startDate?: string } {
  const match = /\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2}|present|current)\b/iu.exec(line);
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match.index > mentionIndex ||
    /[.;]/u.test(line.slice(match.index + match[0].length, mentionIndex))
  ) {
    return {};
  }

  const between = line.slice(match.index + match[0].length, mentionIndex);
  const afterMention = line.slice(mentionIndex + mentionLength);
  const embeddedStart = /\b((?:19|20)\d{2})\b/iu.exec(between)?.[1];
  if (embeddedStart !== undefined) {
    return { startDate: embeddedStart };
  }
  const trailingStart = /\b((?:19|20)\d{2})\b/iu.exec(afterMention.split(/[.;]/u, 1)[0] ?? '')?.[1];
  if (trailingStart !== undefined) {
    return { startDate: trailingStart };
  }
  const specificStart = /\b(?:started|began)(?:\s+[\p{L}-]+){0,3}\s*$/iu.test(between)
    ? /^\s+(?:in|since)\s+((?:19|20)\d{2})\b/iu.exec(afterMention)?.[1]
    : undefined;
  if (specificStart !== undefined) {
    return { startDate: specificStart };
  }
  if (/\b(?:started|began|since)\b/iu.test(between)) {
    return {};
  }

  const endDate = /^(?:19|20)\d{2}$/u.test(match[2]) ? match[2] : undefined;
  return endDate === undefined ? { startDate: match[1] } : { startDate: match[1], endDate };
}

function isNegatedMention(line: string, mentionIndex: number): boolean {
  const prefix = line.slice(0, mentionIndex).toLocaleLowerCase('en-US');
  return /(?:^|\s)(?:no|not|without|lacks?|lacking|never\s+(?:used|worked\s+with))\s+(?:[\p{L}\p{N}-]+\s+){0,3}$/iu.test(
    prefix,
  );
}

function isNonExperienceMention(
  line: string,
  mentionIndex: number,
  mentionLength: number,
): boolean {
  const clauseStart = Math.max(
    line.lastIndexOf('.', mentionIndex - 1),
    line.lastIndexOf(';', mentionIndex - 1),
  );
  const clauseEndCandidates = [
    line.indexOf('.', mentionIndex),
    line.indexOf(';', mentionIndex),
  ].filter((index) => index >= 0);
  const clauseEnd =
    clauseEndCandidates.length === 0 ? line.length : Math.min(...clauseEndCandidates);
  const prefix = line.slice(clauseStart + 1, mentionIndex).toLocaleLowerCase('en-US');
  const suffix = line.slice(mentionIndex + mentionLength, clauseEnd).toLocaleLowerCase('en-US');
  const clause = `${prefix} ${suffix}`;

  return (
    /\b(?:learn(?:ing|ed)?|stud(?:y|ying|ied)|interested\s+in|familiar(?:ity)?\s+with|exposure\s+to|aware\s+of)\b/iu.test(
      prefix,
    ) ||
    /\b(?:never|not)\b.{0,40}\b(?:experience|used|worked)\b|\b(?:experience|used|worked)\b.{0,40}\b(?:never|not)\b/iu.test(
      clause,
    ) ||
    /^[\s,(:-]*(?:experience\s*)?(?::|-)?\s*(?:none\b|never\s+used\b|was\s+never\s+used\b|no\s+(?:production\s+)?experience\b|not\s+used\b|was\s+not\s+used\b|without\s+(?:production\s+)?experience\b)/iu.test(
      suffix,
    )
  );
}

function hasAffirmativeExperienceContext(
  line: string,
  mentionIndex: number,
  inSkillsSection: boolean,
): boolean {
  if (
    inSkillsSection ||
    /^(?:skills?|technical\s+skills|core\s+competencies|technologies|tech(?:nology)?\s+stack|tools|expertise|proficiencies)\s*:/iu.test(
      line,
    )
  ) {
    return true;
  }
  const clauseStart = Math.max(
    line.lastIndexOf('.', mentionIndex - 1),
    line.lastIndexOf(';', mentionIndex - 1),
  );
  const clauseEndCandidates = [
    line.indexOf('.', mentionIndex),
    line.indexOf(';', mentionIndex),
  ].filter((index) => index >= 0);
  const clauseEnd =
    clauseEndCandidates.length === 0 ? line.length : Math.min(...clauseEndCandidates);
  return /\b(?:built|created|delivered|deployed|designed|developed|implemented|integrated|led|maintained|managed|operated|administered|architected|used|using|worked\s+(?:with|on|in)|experience\s+(?:with|in)|experienced\s+(?:with|in)|proficient\s+(?:in|with)|skilled\s+in|responsible\s+for)\b/iu.test(
    line.slice(clauseStart + 1, clauseEnd),
  );
}

export function extractCareerEvidence(
  resume: ParsedDocument,
  aliases: SkillAliasData,
): CareerEvidence[] {
  const evidence: CareerEvidence[] = [];
  let inSkillsSection = false;

  for (const rawLine of resume.text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    if (/^objective\s*:/iu.test(line)) {
      inSkillsSection = false;
      continue;
    }
    if (
      /^(?:summary|experience|employment|education|certifications?|projects?|achievements?)\s*:/iu.test(
        line,
      )
    ) {
      inSkillsSection = false;
    }
    if (
      /^(?:skills?|technical\s+skills|core\s+competencies|technologies|tech(?:nology)?\s+stack|tools|expertise|proficiencies)\s*:/iu.test(
        line,
      )
    ) {
      inSkillsSection = true;
    }
    if (
      /^(?:interests?|hobbies|volunteering|publications?)\s*:/iu.test(line) ||
      /^(?:interests?|hobbies|volunteering|publications?)$/iu.test(line)
    ) {
      inSkillsSection = false;
      continue;
    }
    const heading = line.replace(/:$/u, '').toLocaleLowerCase('en-US');
    if (
      /^(?:skills?|technical\s+skills|core\s+competencies|technologies|tech(?:nology)?\s+stack|tools|expertise|proficiencies)$/u.test(
        heading,
      )
    ) {
      inSkillsSection = true;
      continue;
    }
    if (
      /^(?:objective|summary|experience|employment|education|certifications?|projects?|achievements?)$/u.test(
        heading,
      )
    ) {
      inSkillsSection = false;
      continue;
    }
    for (const mention of extractSkillMentions(line, aliases)) {
      if (
        !hasAffirmativeExperienceContext(line, mention.index, inSkillsSection) ||
        isNegatedMention(line, mention.index) ||
        isNonExperienceMention(line, mention.index, mention.matchedText.length)
      ) {
        continue;
      }
      const dates = extractDateRange(line, mention.index, mention.matchedText.length);
      evidence.push(
        CareerEvidenceSchema.parse({
          id: stableId('evidence', resume.id, mention.canonicalName, line),
          profileId: 'profile-local',
          category: evidenceCategory(mention.category),
          name: mention.canonicalName,
          normalizedName: mention.canonicalName,
          description: `The resume explicitly mentions ${mention.canonicalName}.`,
          ...dates,
          sourceDocumentId: resume.id,
          sourceText: line,
          confidence: 'explicit',
        }),
      );
    }
  }

  return [...new Map(evidence.map((item) => [item.id, item])).values()].sort((left, right) =>
    compareStableStrings(left.id, right.id),
  );
}

function headingImportance(
  line: string,
): JobRequirementImportance | 'responsibilities' | undefined {
  const normalized = line.replace(/:$/u, '').trim().toLocaleLowerCase('en-US');
  if (/^(required qualifications?|requirements?|must have)$/u.test(normalized)) {
    return 'required';
  }
  if (/^(preferred qualifications?|preferred experience|nice to have|bonus)$/u.test(normalized)) {
    return 'preferred';
  }
  if (/^(responsibilities|what you will do|the role)$/u.test(normalized)) {
    return 'responsibilities';
  }
  return undefined;
}

function lineImportances(
  line: string,
  section: JobRequirementImportance | 'responsibilities' | undefined,
): { ambiguous: boolean; values: JobRequirementImportance[] } {
  const normalized = line.toLocaleLowerCase('en-US');
  if (/\b(?:no|not)\b.{0,40}\b(?:required|requires?|mandatory)\b/iu.test(normalized)) {
    return { ambiguous: false, values: ['contextual'] };
  }
  const saysRequired = /\b(required|must|mandatory)\b/u.test(normalized);
  const saysPreferred = /\b(preferred|nice to have|bonus)\b/u.test(normalized);
  if (saysRequired && saysPreferred) {
    return { ambiguous: true, values: ['required', 'preferred'] };
  }
  if (saysRequired) {
    return { ambiguous: false, values: ['required'] };
  }
  if (saysPreferred) {
    return { ambiguous: false, values: ['preferred'] };
  }
  if (section === 'responsibilities') {
    return { ambiguous: false, values: ['required'] };
  }
  return { ambiguous: false, values: [section ?? 'contextual'] };
}

function genericRequirementCategory(line: string): JobRequirementCategory {
  if (/\bclearance\b/iu.test(line)) {
    return 'clearance';
  }
  if (/\b(?:authorization|authorised|authorized|sponsorship)\b/iu.test(line)) {
    return 'authorization';
  }
  if (/\blicen[cs]e\b/iu.test(line)) {
    return 'license';
  }
  if (/\b(?:degree|education|certification)\b/iu.test(line)) {
    return 'education';
  }
  if (/\b(?:location|remote|hybrid|on-site|onsite)\b/iu.test(line)) {
    return 'location';
  }
  return 'other';
}

function genericRequirementName(line: string): string {
  return line
    .replace(/^\d+(?:\.\d+)?\+?\s+years?\s+(?:of\s+)?/iu, '')
    .replace(/\b(?:is\s+)?(?:required|preferred|mandatory)\b[.!]?$/iu, '')
    .trim();
}

function isContextualMetadata(line: string): boolean {
  return /^(?:(?:the\s+)?salary(?:\s+range)?|base\s+(?:pay|salary)|compensation|pay\s+range|benefits?|perks?|what\s+we\s+offer|what\s+we\s+provide|location|workplace|work\s+arrangement|about(?:\s+us|\s+the\s+company)?)(?:\s*:|\s+is\b|$)/iu.test(
    line.trim(),
  );
}

function requirementClauses(line: string): string[] {
  return line
    .split(/\s*;\s*|\s*(?:,)?\s+\b(?:but|however)\b\s*/iu)
    .flatMap((clause) => {
      const independent =
        /^(.*\b(?:no|not)\b.{0,40}\b(?:required|requires?)\b)\s+and\s+(.+\b(?:required|requires?|mandatory|must)\b.*)$/iu.exec(
          clause,
        );
      return independent?.[1] === undefined || independent[2] === undefined
        ? [clause]
        : [independent[1], independent[2]];
    })
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

function requirementComparisonKey(requirement: JobRequirement): string {
  return (requirement.normalizedName ?? genericRequirementName(requirement.text))
    .trim()
    .toLocaleLowerCase('en-US');
}

function requestedYears(
  line: string,
  mentionIndex?: number,
  mentionLength = 0,
): number | undefined {
  const matches = [...line.matchAll(/\b(\d+(?:\.\d+)?)\+?\s+years?\b/giu)];
  const match =
    mentionIndex === undefined
      ? matches[0]
      : matches
          .map((candidate) => {
            const candidateIndex = candidate.index ?? 0;
            const candidateEnd = candidateIndex + candidate[0].length;
            const mentionEnd = mentionIndex + mentionLength;
            const distance =
              candidateEnd <= mentionIndex
                ? mentionIndex - candidateEnd
                : candidateIndex >= mentionEnd
                  ? candidateIndex - mentionEnd
                  : 0;
            return { candidate, distance };
          })
          .sort(
            (left, right) =>
              left.distance - right.distance ||
              (left.candidate.index ?? 0) - (right.candidate.index ?? 0),
          )[0]?.candidate;
  if (match?.[1] === undefined) {
    return undefined;
  }
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function extractJobRequirements(
  job: ParsedDocument,
  aliases: SkillAliasData,
): RequirementExtractionResult {
  let section: JobRequirementImportance | 'responsibilities' | undefined;
  let foundHeading = false;
  let ambiguousImportance = false;
  const requirements: JobRequirement[] = [];

  for (const rawLine of job.text.split('\n')) {
    const withoutBullet = rawLine.trim().replace(/^[-*•]\s*/u, '');
    if (withoutBullet.length === 0) {
      continue;
    }
    const heading = headingImportance(withoutBullet);
    if (heading !== undefined) {
      section = heading;
      foundHeading = true;
      continue;
    }
    if (isContextualMetadata(withoutBullet)) {
      section = undefined;
      continue;
    }

    for (const clause of requirementClauses(withoutBullet)) {
      const importance = lineImportances(clause, section);
      ambiguousImportance ||= importance.ambiguous;
      const mentions = extractSkillMentions(clause, aliases);
      const genericCategory = genericRequirementCategory(clause);
      for (const mention of mentions) {
        for (const value of importance.values) {
          const years = requestedYears(clause, mention.index, mention.matchedText.length);
          requirements.push(
            JobRequirementSchema.parse({
              id: stableId('requirement', job.id, mention.canonicalName, value, clause),
              category: requirementCategory(mention.category),
              text: clause,
              normalizedName: mention.canonicalName,
              importance: value,
              ...(years === undefined ? {} : { yearsRequested: years }),
            }),
          );
        }
      }
      if (
        (mentions.length === 0 || genericCategory !== 'other') &&
        (section !== undefined || importance.values.some((value) => value !== 'contextual'))
      ) {
        for (const value of importance.values) {
          const years = requestedYears(clause);
          const normalizedName = genericRequirementName(clause);
          requirements.push(
            JobRequirementSchema.parse({
              id: stableId('requirement', job.id, normalizedName, value, clause),
              category: genericCategory,
              text: clause,
              importance: value,
              ...(years === undefined ? {} : { yearsRequested: years }),
            }),
          );
        }
      }
    }
  }

  const uniqueRequirements = new Map<string, JobRequirement>();
  for (const requirement of requirements) {
    const key = [
      requirementComparisonKey(requirement),
      requirement.category,
      requirement.importance,
    ].join('\0');
    const existing = uniqueRequirements.get(key);
    if (
      existing === undefined ||
      (requirement.yearsRequested ?? -1) > (existing.yearsRequested ?? -1) ||
      ((requirement.yearsRequested ?? -1) === (existing.yearsRequested ?? -1) &&
        compareStableStrings(requirement.id, existing.id) < 0)
    ) {
      uniqueRequirements.set(key, requirement);
    }
  }

  const grouped = new Map<string, Set<JobRequirementImportance>>();
  for (const requirement of uniqueRequirements.values()) {
    const key = requirementComparisonKey(requirement);
    const importances = grouped.get(key) ?? new Set<JobRequirementImportance>();
    importances.add(requirement.importance);
    grouped.set(key, importances);
  }
  const specificNames = new Set(
    [...grouped.entries()]
      .filter(([, values]) => values.has('required') || values.has('preferred'))
      .map(([name]) => name),
  );
  const filteredRequirements = [...uniqueRequirements.values()].filter(
    (requirement) =>
      requirement.importance !== 'contextual' ||
      !specificNames.has(requirementComparisonKey(requirement)),
  );

  const finalGrouped = new Map<string, Set<JobRequirementImportance>>();
  for (const requirement of filteredRequirements) {
    const key = requirementComparisonKey(requirement);
    const values = finalGrouped.get(key) ?? new Set<JobRequirementImportance>();
    values.add(requirement.importance);
    finalGrouped.set(key, values);
  }
  const hasConflicts =
    ambiguousImportance || [...finalGrouped.values()].some((values) => values.size > 1);
  const orderedRequirements = filteredRequirements.sort((left, right) =>
    compareStableStrings(left.id, right.id),
  );
  const exceedsRequirementLimit = orderedRequirements.length > MAX_ANALYZED_REQUIREMENTS;
  const warnings: string[] = [];
  if (!foundHeading || hasConflicts) {
    warnings.push('Required versus preferred importance is ambiguous.');
  }
  if (exceedsRequirementLimit) {
    warnings.push(
      `Requirement count exceeds the ${MAX_ANALYZED_REQUIREMENTS}-item analysis limit.`,
    );
  }

  return {
    confidence: foundHeading && !hasConflicts && !exceedsRequirementLimit ? 1 : 0.5,
    hasConflicts,
    requirements: orderedRequirements.slice(0, MAX_ANALYZED_REQUIREMENTS),
    warnings,
  };
}

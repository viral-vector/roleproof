import type { MatchClassification, SkillAliasData, SkillRelationshipData } from '@roleproof/shared';

import { compareStableStrings } from './ordering.js';

export interface SkillMention {
  canonicalName: string;
  category: SkillAliasData['skills'][number]['category'];
  index: number;
  matchedText: string;
}

function comparisonKey(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findTerm(text: string, term: string): { index: number; matchedText: string } | undefined {
  const expression = new RegExp(
    `(?<![\\p{L}\\p{N}.])${escapeRegularExpression(term)}(?![\\p{L}\\p{N}])`,
    'iu',
  );
  const match = expression.exec(text);
  if (match?.index === undefined || match[0] === undefined) {
    return undefined;
  }
  return { index: match.index, matchedText: match[0] };
}

export function normalizeSkillName(name: string, data: SkillAliasData): string | undefined {
  const key = comparisonKey(name);
  for (const skill of data.skills) {
    if (
      [skill.canonicalName, ...skill.aliases].some((candidate) => comparisonKey(candidate) === key)
    ) {
      return skill.canonicalName;
    }
  }
  return undefined;
}

export function extractSkillMentions(text: string, data: SkillAliasData): SkillMention[] {
  const mentions: SkillMention[] = [];

  for (const skill of data.skills) {
    let earliest: { index: number; matchedText: string } | undefined;
    for (const name of [skill.canonicalName, ...skill.aliases]) {
      const found = findTerm(text, name);
      if (found !== undefined && (earliest === undefined || found.index < earliest.index)) {
        earliest = found;
      }
    }
    if (earliest !== undefined) {
      mentions.push({
        canonicalName: skill.canonicalName,
        category: skill.category,
        index: earliest.index,
        matchedText: earliest.matchedText,
      });
    }
  }

  return mentions.sort(
    (left, right) =>
      left.index - right.index || compareStableStrings(left.canonicalName, right.canonicalName),
  );
}

export function findSkillRelationship(
  source: string,
  target: string,
  data: SkillRelationshipData,
): Extract<MatchClassification, 'partially-related' | 'strongly-related'> | undefined {
  const sourceKey = comparisonKey(source);
  const targetKey = comparisonKey(target);

  for (const relationship of data.relationships) {
    const direct =
      comparisonKey(relationship.source) === sourceKey &&
      comparisonKey(relationship.target) === targetKey;
    const reverse =
      relationship.direction === 'bidirectional' &&
      comparisonKey(relationship.source) === targetKey &&
      comparisonKey(relationship.target) === sourceKey;
    if (direct || reverse) {
      return relationship.classification;
    }
  }
  return undefined;
}

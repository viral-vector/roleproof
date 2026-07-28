import { existsSync, readFileSync } from 'node:fs';

import {
  SkillAliasDataSchema,
  SkillRelationshipDataSchema,
  type SkillAliasData,
  type SkillRelationshipData,
} from '@roleproof/shared';

export interface NormalizationData {
  aliases: SkillAliasData;
  relationships: SkillRelationshipData;
}

function readDataFile(fileName: string): unknown {
  const candidates = [
    new URL(`../data/${fileName}`, import.meta.url),
    new URL(`../../../data/${fileName}`, import.meta.url),
  ];
  const dataUrl = candidates.find((candidate) => existsSync(candidate));
  if (dataUrl === undefined) {
    throw new Error(`RoleProof normalization data is missing: ${fileName}`);
  }

  return JSON.parse(readFileSync(dataUrl, 'utf8')) as unknown;
}

export const DEFAULT_NORMALIZATION_DATA: Readonly<NormalizationData> = Object.freeze({
  aliases: SkillAliasDataSchema.parse(readDataFile('skill-aliases.json')),
  relationships: SkillRelationshipDataSchema.parse(readDataFile('skill-relationships.json')),
});

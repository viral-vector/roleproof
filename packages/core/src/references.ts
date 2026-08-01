import { createHash } from 'node:crypto';

import {
  EvidenceReferenceSchema,
  type CandidateContext,
  type CareerEvidence,
  type EvidenceReference,
} from '@roleproof/shared';

import { compareStableStrings } from './ordering.js';

type EvidenceCitingResult = {
  profileId?: string | undefined;
  resumeDocumentId?: string | undefined;
  matchedRequirements: { evidenceIds: string[] }[];
  unsupportedClaims: { evidenceIds: string[] }[];
  suggestedEmphasis: { evidenceIds: string[] }[];
  suggestedAdditions: { evidenceIds: string[] }[];
  scoreContributions: { evidenceIds: string[] }[] | undefined;
};

export function profileFactEvidenceIds(context: CandidateContext): Set<string> {
  const values: Array<[string, string]> = [
    ...(context.workAuthorization === undefined
      ? []
      : ([['authorization', context.workAuthorization]] as Array<[string, string]>)),
    ...context.education.map((value): [string, string] => ['education', value]),
    ...context.certifications.map((value): [string, string] => ['education', value]),
    ...context.licenses.map((value): [string, string] => ['license', value]),
    ...context.preferredLocations.map((value): [string, string] => ['location', value]),
    ...(context.remotePreference === undefined
      ? []
      : ([['location', context.remotePreference]] as Array<[string, string]>)),
    ...context.clearances.map((value): [string, string] => ['clearance', value]),
  ];
  return new Set(
    values.map(
      ([category, value]) => `evidence-context-${sha256(`${category}\0${value}`).slice(0, 16)}`,
    ),
  );
}

export function buildEvidenceReferences(
  result: EvidenceCitingResult,
  evidence: CareerEvidence[],
  profileFactIds: Set<string>,
): EvidenceReference[] {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const citedIds = new Set(
    [
      ...result.matchedRequirements,
      ...result.unsupportedClaims,
      ...result.suggestedEmphasis,
      ...result.suggestedAdditions,
      ...(result.scoreContributions ?? []),
    ].flatMap(({ evidenceIds }) => evidenceIds),
  );
  return [...citedIds].sort(compareStableStrings).map((evidenceId) => {
    const careerEvidence = evidenceById.get(evidenceId);
    return EvidenceReferenceSchema.parse(
      careerEvidence === undefined && profileFactIds.has(evidenceId)
        ? {
            evidenceId,
            sourceType: 'profile-fact',
            sourceId: result.profileId,
            confidence: 'user-confirmed',
          }
        : careerEvidence === undefined
          ? {
              evidenceId,
              sourceType: 'resume-text',
              sourceId: result.resumeDocumentId,
              sourceDocumentId: result.resumeDocumentId,
              confidence: 'explicit',
            }
          : {
              evidenceId,
              sourceType: 'career-evidence',
              sourceId: careerEvidence.id,
              sourceDocumentId: careerEvidence.sourceDocumentId,
              ...(careerEvidence.sourceText === undefined
                ? {}
                : { sourceText: careerEvidence.sourceText }),
              confidence: careerEvidence.confidence,
            },
    );
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

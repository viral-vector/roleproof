import { describe, expect, it } from 'vitest';
import { EvidenceReferenceSchema, type CandidateContext } from '@roleproof/shared';

import { buildEvidenceReferences, profileFactEvidenceIds } from '../src/references.js';

const context: CandidateContext = {
  preferredLocations: ['Berlin'],
  remotePreference: 'hybrid',
  workAuthorization: 'authorized',
  clearances: ['secret'],
  licenses: ['driver-license'],
  education: ['bachelor-degree'],
  certifications: ['fictional-certification'],
};

describe('profileFactEvidenceIds', () => {
  it('derives deterministic profile-fact evidence ids per category', () => {
    const ids = profileFactEvidenceIds(context);

    expect(ids.size).toBe(7);
    for (const id of ids) {
      expect(id).toMatch(/^evidence-context-[a-f\d]{16}$/u);
    }
    expect(profileFactEvidenceIds(context)).toEqual(ids);
  });

  it('is stable when unrelated context fields change', () => {
    const before = profileFactEvidenceIds({ ...context, preferredLocations: ['Hamburg'] });
    const after = profileFactEvidenceIds({ ...context, preferredLocations: ['Hamburg'] });
    expect(after).toEqual(before);
  });
});

describe('buildEvidenceReferences', () => {
  const evidence = [
    {
      id: 'evidence-skill',
      category: 'skill' as const,
      name: 'TypeScript',
      description: 'Built fictional services.',
      sourceDocumentId: 'document-1',
      sourceText: 'Fictional source text',
      confidence: 'explicit' as const,
      profileId: 'profile-1',
    },
  ];
  const profileFactIds = new Set(['evidence-context-location']);

  function resultWith(evidenceIds: string[]) {
    return {
      profileId: 'profile-1',
      resumeDocumentId: 'document-1',
      matchedRequirements: [{ evidenceIds }],
      unsupportedClaims: [],
      suggestedEmphasis: [],
      suggestedAdditions: [],
      scoreContributions: undefined,
    };
  }

  it('maps cited career evidence to provenance-valid references', () => {
    const references = buildEvidenceReferences(
      resultWith(['evidence-skill']),
      evidence,
      profileFactIds,
    );

    expect(references).toHaveLength(1);
    expect(references[0]).toEqual(
      EvidenceReferenceSchema.parse({
        evidenceId: 'evidence-skill',
        sourceType: 'career-evidence',
        sourceId: 'evidence-skill',
        sourceDocumentId: 'document-1',
        sourceText: 'Fictional source text',
        confidence: 'explicit',
      }),
    );
  });

  it('maps cited profile facts to user-confirmed references', () => {
    const references = buildEvidenceReferences(
      resultWith(['evidence-context-location']),
      evidence,
      profileFactIds,
    );

    expect(references[0]).toEqual(
      EvidenceReferenceSchema.parse({
        evidenceId: 'evidence-context-location',
        sourceType: 'profile-fact',
        sourceId: 'profile-1',
        confidence: 'user-confirmed',
      }),
    );
  });

  it('maps uncited resume-text evidence to explicit references', () => {
    const references = buildEvidenceReferences(
      resultWith(['evidence-resume']),
      evidence,
      profileFactIds,
    );

    expect(references[0]).toEqual(
      EvidenceReferenceSchema.parse({
        evidenceId: 'evidence-resume',
        sourceType: 'resume-text',
        sourceId: 'document-1',
        sourceDocumentId: 'document-1',
        confidence: 'explicit',
      }),
    );
  });

  it('sorts references by evidence id and cites every referenced id exactly once', () => {
    const references = buildEvidenceReferences(
      resultWith(['evidence-z', 'evidence-skill', 'evidence-context-location']),
      evidence,
      profileFactIds,
    );

    expect(references.map(({ evidenceId }) => evidenceId)).toEqual([
      'evidence-context-location',
      'evidence-skill',
      'evidence-z',
    ]);
    expect(new Set(references.map(({ evidenceId }) => evidenceId)).size).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';

import type { CandidateContext, CareerEvidence, JobRequirement } from '@roleproof/shared';

import { DEFAULT_NORMALIZATION_DATA, matchEvidence } from '../src/index.js';

const requirements: JobRequirement[] = [
  {
    id: 'requirement-typescript',
    category: 'language',
    text: 'TypeScript is required.',
    normalizedName: 'TypeScript',
    importance: 'required',
  },
  {
    id: 'requirement-kubernetes',
    category: 'infrastructure',
    text: 'Kubernetes is required.',
    normalizedName: 'Kubernetes',
    importance: 'required',
  },
  {
    id: 'requirement-graphql',
    category: 'other',
    text: 'GraphQL is required.',
    normalizedName: 'GraphQL',
    importance: 'required',
  },
];

const evidence: CareerEvidence[] = [
  {
    id: 'evidence-typescript',
    profileId: 'profile-local',
    category: 'skill',
    name: 'TypeScript',
    normalizedName: 'TypeScript',
    description: 'Explicit TypeScript evidence.',
    sourceDocumentId: 'resume-1',
    sourceText: 'Built TypeScript services.',
    confidence: 'explicit',
  },
  {
    id: 'evidence-docker',
    profileId: 'profile-local',
    category: 'skill',
    name: 'Docker',
    normalizedName: 'Docker',
    description: 'Explicit Docker evidence.',
    sourceDocumentId: 'resume-1',
    sourceText: 'Deployed services with Docker.',
    confidence: 'explicit',
  },
];

describe('matchEvidence', () => {
  it('distinguishes direct, related, and unsupported requirements', () => {
    const matches = matchEvidence(requirements, evidence, DEFAULT_NORMALIZATION_DATA.relationships);

    expect(matches).toEqual([
      expect.objectContaining({
        requirementId: 'requirement-graphql',
        classification: 'unsupported',
        evidenceIds: [],
        score: 0,
      }),
      expect.objectContaining({
        requirementId: 'requirement-kubernetes',
        classification: 'partially-related',
        evidenceIds: ['evidence-docker'],
        score: 0.4,
      }),
      expect.objectContaining({
        requirementId: 'requirement-typescript',
        classification: 'direct',
        evidenceIds: ['evidence-typescript'],
        score: 1,
      }),
    ]);
  });

  it('never promotes related evidence to direct and is stable across runs', () => {
    const first = matchEvidence(requirements, evidence, DEFAULT_NORMALIZATION_DATA.relationships);
    const second = matchEvidence(
      [...requirements].reverse(),
      [...evidence].reverse(),
      DEFAULT_NORMALIZATION_DATA.relationships,
    );

    expect(second).toEqual(first);
    expect(first.find((match) => match.requirementId === 'requirement-kubernetes')).toEqual(
      expect.objectContaining({ classification: 'partially-related' }),
    );
  });

  it('requires confirmation for inferred same-name evidence without awarding points', () => {
    const [match] = matchEvidence(
      [requirements[0]!],
      [{ ...evidence[0]!, id: 'evidence-inferred-typescript', confidence: 'inferred' }],
      DEFAULT_NORMALIZATION_DATA.relationships,
    );

    expect(match).toEqual(
      expect.objectContaining({
        classification: 'requires-user-confirmation',
        evidenceIds: ['evidence-inferred-typescript'],
        score: 0,
      }),
    );
  });

  it('does not award points for inferred related evidence', () => {
    const [match] = matchEvidence(
      [requirements[1]!],
      [{ ...evidence[1]!, id: 'evidence-inferred-docker', confidence: 'inferred' }],
      DEFAULT_NORMALIZATION_DATA.relationships,
    );

    expect(match).toEqual(
      expect.objectContaining({
        classification: 'requires-user-confirmation',
        evidenceIds: ['evidence-inferred-docker'],
        score: 0,
      }),
    );
  });

  it.each(['explicit', 'user-confirmed'] as const)(
    'keeps %s evidence eligible under existing direct and related rules',
    (confidence) => {
      const matches = matchEvidence(
        [requirements[0]!, requirements[1]!],
        evidence.map((item) => ({ ...item, confidence })),
        DEFAULT_NORMALIZATION_DATA.relationships,
      );

      expect(matches.find((match) => match.requirementId === 'requirement-typescript')).toEqual(
        expect.objectContaining({ classification: 'direct', score: 1 }),
      );
      expect(matches.find((match) => match.requirementId === 'requirement-kubernetes')).toEqual(
        expect.objectContaining({ classification: 'partially-related', score: 0.4 }),
      );
    },
  );

  it('downgrades an unverified years requirement without inventing duration', () => {
    const [match] = matchEvidence(
      [{ ...requirements[0]!, id: 'requirement-years', yearsRequested: 5 }],
      evidence,
      DEFAULT_NORMALIZATION_DATA.relationships,
    );

    expect(match).toEqual(
      expect.objectContaining({
        classification: 'partially-related',
        evidenceIds: ['evidence-typescript'],
        score: 0.4,
      }),
    );
    expect(match?.explanation).toContain('duration requires confirmation');
  });

  it('accepts an explicit years-of-experience claim for the same canonical skill', () => {
    const [match] = matchEvidence(
      [{ ...requirements[0]!, id: 'requirement-explicit-years', yearsRequested: 7 }],
      [
        {
          ...evidence[0]!,
          id: 'evidence-explicit-years',
          sourceText: '14+ years of TypeScript experience.',
        },
      ],
      DEFAULT_NORMALIZATION_DATA.relationships,
    );

    expect(match).toEqual(
      expect.objectContaining({
        classification: 'direct',
        evidenceIds: ['evidence-explicit-years'],
      }),
    );
  });

  it('does not award a strong related match for unverified requested duration', () => {
    const [durationMatch] = matchEvidence(
      [
        {
          id: 'requirement-kubernetes-years',
          category: 'infrastructure',
          text: '5+ years Kubernetes required',
          normalizedName: 'Kubernetes',
          importance: 'required',
          yearsRequested: 5,
        },
      ],
      [
        {
          id: 'evidence-aks',
          profileId: 'profile-local',
          category: 'skill',
          name: 'AKS',
          normalizedName: 'AKS',
          description: 'Explicit AKS evidence.',
          sourceDocumentId: 'resume-1',
          sourceText: 'Worked with AKS.',
          confidence: 'explicit',
        },
      ],
      DEFAULT_NORMALIZATION_DATA.relationships,
    );

    expect(durationMatch?.classification).toBe('partially-related');
    expect(durationMatch?.explanation).toContain('duration requires confirmation');
  });

  it('does not infer a full requested duration from year-only boundary dates', () => {
    const [durationMatch] = matchEvidence(
      [{ ...requirements[0]!, id: 'requirement-boundary-years', yearsRequested: 5 }],
      [
        {
          ...evidence[0]!,
          id: 'evidence-boundary-years',
          startDate: '2020',
          endDate: '2025',
        },
      ],
      DEFAULT_NORMALIZATION_DATA.relationships,
    );

    expect(durationMatch?.classification).toBe('partially-related');
  });

  it('keeps unnormalized requirements unknown instead of claiming missing evidence', () => {
    const [match] = matchEvidence(
      [
        {
          id: 'requirement-rust',
          category: 'other',
          text: 'Rust',
          importance: 'required',
        },
      ],
      evidence,
      DEFAULT_NORMALIZATION_DATA.relationships,
    );

    expect(match).toEqual(
      expect.objectContaining({
        classification: 'unknown',
        evidenceIds: [],
        score: 0,
      }),
    );
  });

  it('matches explicit candidate-context eligibility facts with evidence IDs', () => {
    const eligibilityRequirements: JobRequirement[] = [
      {
        id: 'requirement-license',
        category: 'license',
        text: 'Professional Engineer license required',
        importance: 'required',
      },
      {
        id: 'requirement-location',
        category: 'location',
        text: 'Remote work required',
        importance: 'required',
      },
    ];

    const matches = matchEvidence(
      eligibilityRequirements,
      evidence,
      DEFAULT_NORMALIZATION_DATA.relationships,
      {
        preferredLocations: [],
        remotePreference: 'remote',
        clearances: [],
        licenses: ['Professional Engineer'],
        education: [],
        certifications: [],
      },
    );

    expect(matches).toEqual([
      expect.objectContaining({
        requirementId: 'requirement-license',
        classification: 'direct',
        evidenceIds: [expect.any(String)],
      }),
      expect.objectContaining({
        requirementId: 'requirement-location',
        classification: 'direct',
        evidenceIds: [expect.any(String)],
      }),
    ]);
  });

  it('does not promote an underspecified eligibility value to direct support', () => {
    const [match] = matchEvidence(
      [
        {
          id: 'requirement-master-degree',
          category: 'education',
          text: 'Master degree in computer science required',
          importance: 'required',
        },
      ],
      evidence,
      DEFAULT_NORMALIZATION_DATA.relationships,
      {
        preferredLocations: [],
        clearances: [],
        licenses: [],
        education: ['degree'],
        certifications: [],
      },
    );

    expect(match).toEqual(
      expect.objectContaining({ classification: 'unknown', evidenceIds: [], score: 0 }),
    );
  });

  it.each([
    [
      'authorization',
      'Candidates must be authorized to work in the US without sponsorship',
      { workAuthorization: 'Not authorized to work in US without sponsorship' },
    ],
    [
      'authorization',
      'Candidates must be authorized to work in the US without sponsorship',
      { workAuthorization: 'Not currently authorized to work in US without sponsorship' },
    ],
    [
      'authorization',
      'Candidates must be authorized to work in the US without sponsorship',
      { workAuthorization: 'Unauthorized to work in US without sponsorship' },
    ],
    [
      'authorization',
      'Candidates must be authorized to work in the US without sponsorship',
      { workAuthorization: 'Authorized to work in Canada without sponsorship' },
    ],
    ['license', 'Commercial pilot license with experience required', { licenses: ['PE'] }],
    ['location', 'Must work onsite in Austin', { preferredLocations: ['US'] }],
    ['location', 'New York location required', { preferredLocations: ['York'] }],
    [
      'education',
      'Master degree in computer science required',
      { education: ['Master degree in Fine Arts'] },
    ],
  ] satisfies Array<[JobRequirement['category'], string, Partial<CandidateContext>]>)(
    'does not use substring evidence for %s eligibility',
    (category, text, contextValues) => {
      const [match] = matchEvidence(
        [
          {
            id: `requirement-${category}`,
            category,
            text,
            importance: 'required',
          },
        ],
        evidence,
        DEFAULT_NORMALIZATION_DATA.relationships,
        {
          preferredLocations: [],
          clearances: [],
          licenses: [],
          education: [],
          certifications: [],
          ...contextValues,
        },
      );

      expect(match).toEqual(
        expect.objectContaining({ classification: 'unknown', evidenceIds: [], score: 0 }),
      );
    },
  );

  it('does not treat clearance eligibility as a held compartmented clearance', () => {
    const [match] = matchEvidence(
      [
        {
          id: 'requirement-ts-sci',
          category: 'clearance',
          text: 'Top Secret/SCI clearance required',
          importance: 'required',
        },
      ],
      evidence,
      DEFAULT_NORMALIZATION_DATA.relationships,
      {
        preferredLocations: [],
        clearances: ['Top Secret SCI eligible'],
        licenses: [],
        education: [],
        certifications: [],
      },
    );

    expect(match).toEqual(
      expect.objectContaining({ classification: 'unknown', evidenceIds: [], score: 0 }),
    );
  });

  it('caps evidence references per match deterministically', () => {
    const manyEvidence = Array.from({ length: 101 }, (_, index): CareerEvidence => ({
      ...evidence[0]!,
      id: `evidence-typescript-${index.toString().padStart(3, '0')}`,
      sourceText: `Built TypeScript service ${index}.`,
    }));

    const [result] = matchEvidence(
      [requirements[0]!],
      manyEvidence,
      DEFAULT_NORMALIZATION_DATA.relationships,
    );

    expect(result?.evidenceIds).toHaveLength(100);
    expect(result?.evidenceIds[0]).toBe('evidence-typescript-000');
    expect(result?.evidenceIds.at(-1)).toBe('evidence-typescript-099');
  });
});

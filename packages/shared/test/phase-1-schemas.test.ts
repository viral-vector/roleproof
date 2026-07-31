import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AnalysisEnvelopeSchema,
  AnalysisResultSchema,
  CandidateContextSchema,
  DeterministicAnalysisInputSchema,
  EvidenceAwareDeterministicAnalysisInputSchema,
  ParseWarningSchema,
  ParsedDocumentSchema,
  ParserConfigSchema,
  ScoreContributionSchema,
  ScoringConfigSchema,
  SkillAliasDataSchema,
  SkillRelationshipDataSchema,
  type AnalysisEnvelope,
  type DeterministicAnalysisInput,
  type EvidenceAwareDeterministicAnalysisInput,
} from '../src/index.js';

const resumeDocument = {
  schemaVersion: '1.0',
  id: 'resume-a1',
  kind: 'resume',
  format: 'plaintext',
  text: 'Avery built fictional TypeScript services.',
  confidence: 1,
  warnings: [],
} as const;

const jobDocument = {
  schemaVersion: '1.0',
  id: 'job-b1',
  kind: 'job',
  format: 'plaintext',
  text: 'Required: TypeScript backend experience.',
  confidence: 1,
  warnings: [],
} as const;

const candidateContext = {
  preferredLocations: ['Remote'],
  remotePreference: 'remote',
  targetSalaryMin: 120_000,
  targetSalaryMax: 150_000,
  workAuthorization: 'Authorized without sponsorship',
  clearances: [],
  licenses: [],
  education: ['Fictional State University'],
  certifications: [],
} as const;

const scoringConfig = {
  version: '1.0.0',
  weights: {
    requiredTechnical: 35,
    responsibilities: 20,
    seniorityLeadership: 15,
    domain: 10,
    infrastructureDelivery: 10,
    preferred: 5,
    eligibilityLogistics: 5,
  },
  matchValues: {
    direct: 1,
    'strongly-related': 0.75,
    'partially-related': 0.4,
    unsupported: 0,
    unknown: 0,
    'requires-user-confirmation': 0,
  },
  thresholds: {
    applyMinimum: 75,
    stretchMinimum: 55,
    lowConfidence: 0.6,
    mandatorySupportRatio: 0.6,
  },
} as const;

describe('ParsedDocumentSchema', () => {
  it('accepts normalized fictional plaintext documents', () => {
    expect(ParsedDocumentSchema.parse(resumeDocument)).toEqual(resumeDocument);
    expect(ParsedDocumentSchema.parse(jobDocument)).toEqual(jobDocument);
  });

  it.each(['pdf-empty-page', 'pdf-low-text-content', 'possible-truncation', 'ambiguous-layout'])(
    'accepts the %s warning code',
    (code) => {
      expect(
        ParseWarningSchema.safeParse({ code, message: 'Fictional parser warning.' }).success,
      ).toBe(true);
    },
  );

  it('rejects blank text, invalid confidence, and a PDF job document', () => {
    expect(ParsedDocumentSchema.safeParse({ ...resumeDocument, text: ' ' }).success).toBe(false);
    expect(ParsedDocumentSchema.safeParse({ ...resumeDocument, confidence: 1.1 }).success).toBe(
      false,
    );
    expect(ParsedDocumentSchema.safeParse({ ...jobDocument, format: 'pdf' }).success).toBe(false);
  });
});

describe('CandidateContextSchema', () => {
  it('accepts explicit stateless candidate facts', () => {
    expect(CandidateContextSchema.parse(candidateContext)).toEqual(candidateContext);
  });

  it('rejects invalid or reversed salary targets', () => {
    expect(
      CandidateContextSchema.safeParse({ ...candidateContext, targetSalaryMin: -1 }).success,
    ).toBe(false);
    expect(
      CandidateContextSchema.safeParse({
        ...candidateContext,
        targetSalaryMin: 160_000,
        targetSalaryMax: 150_000,
      }).success,
    ).toBe(false);
  });
});

describe('DeterministicAnalysisInputSchema', () => {
  it('accepts a resume, plaintext job, and candidate context', () => {
    const input = DeterministicAnalysisInputSchema.parse({
      resume: resumeDocument,
      job: jobDocument,
      candidateContext,
    });

    expectTypeOf(input).toEqualTypeOf<DeterministicAnalysisInput>();
  });

  it('rejects documents assigned to the wrong roles', () => {
    expect(
      DeterministicAnalysisInputSchema.safeParse({
        resume: jobDocument,
        job: resumeDocument,
        candidateContext,
      }).success,
    ).toBe(false);
  });
});

describe('EvidenceAwareDeterministicAnalysisInputSchema', () => {
  const evidence = {
    id: 'evidence-a1',
    profileId: 'profile-a1',
    category: 'skill',
    name: 'TypeScript',
    normalizedName: 'TypeScript',
    description: 'Explicit fictional TypeScript evidence.',
    sourceDocumentId: resumeDocument.id,
    confidence: 'explicit',
  } as const;

  it('accepts validated caller-supplied evidence without changing the legacy input schema', () => {
    const parsed = EvidenceAwareDeterministicAnalysisInputSchema.parse({
      resume: resumeDocument,
      job: jobDocument,
      candidateContext,
      profileId: 'profile-a1',
      evidence: [evidence],
    });

    expectTypeOf(parsed).toEqualTypeOf<EvidenceAwareDeterministicAnalysisInput>();
    expect(
      DeterministicAnalysisInputSchema.safeParse({
        resume: resumeDocument,
        job: jobDocument,
        candidateContext,
      }).success,
    ).toBe(true);
  });

  it('rejects invalid evidence and evidence owned by another supplied profile', () => {
    const base = {
      resume: resumeDocument,
      job: jobDocument,
      candidateContext,
      profileId: 'profile-a1',
    };

    expect(
      EvidenceAwareDeterministicAnalysisInputSchema.safeParse({
        ...base,
        evidence: [{ ...evidence, confidence: 'likely' }],
      }).success,
    ).toBe(false);
    expect(
      EvidenceAwareDeterministicAnalysisInputSchema.safeParse({
        ...base,
        evidence: [{ ...evidence, profileId: 'profile-other' }],
      }).success,
    ).toBe(false);
  });
});

describe('ScoreContributionSchema', () => {
  const contribution = {
    requirementId: 'requirement-1',
    scoringCategory: 'required-technical',
    classification: 'direct',
    evidenceIds: ['evidence-1'],
    appliedWeight: 35,
    pointsAwarded: 35,
    explanation: 'Explicit fictional TypeScript evidence.',
  } as const;

  it('accepts an auditable contribution', () => {
    expect(ScoreContributionSchema.parse(contribution)).toEqual(contribution);
  });

  it('rejects points above weight and supported contributions without evidence', () => {
    expect(ScoreContributionSchema.safeParse({ ...contribution, pointsAwarded: 36 }).success).toBe(
      false,
    );
    expect(ScoreContributionSchema.safeParse({ ...contribution, evidenceIds: [] }).success).toBe(
      false,
    );
  });
});

describe('normalization data schemas', () => {
  const aliases = {
    schemaVersion: '1.0',
    skills: [
      {
        canonicalName: 'TypeScript',
        category: 'language',
        aliases: ['TS'],
      },
      {
        canonicalName: 'JavaScript',
        category: 'language',
        aliases: ['JS'],
      },
    ],
  } as const;

  it('accepts unique aliases', () => {
    expect(SkillAliasDataSchema.safeParse(aliases).success).toBe(true);
  });

  it('rejects aliases assigned to multiple canonical skills', () => {
    expect(
      SkillAliasDataSchema.safeParse({
        ...aliases,
        skills: [
          ...aliases.skills,
          { canonicalName: 'TestScript', category: 'language', aliases: ['TS'] },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts typed directed relationships and rejects self-relations', () => {
    const relationship = {
      schemaVersion: '1.0',
      relationships: [
        {
          source: 'Docker',
          target: 'Kubernetes',
          direction: 'directed',
          classification: 'partially-related',
        },
      ],
    } as const;

    expect(SkillRelationshipDataSchema.safeParse(relationship).success).toBe(true);
    expect(
      SkillRelationshipDataSchema.safeParse({
        ...relationship,
        relationships: [{ ...relationship.relationships[0], target: 'Docker' }],
      }).success,
    ).toBe(false);
  });
});

describe('configuration schemas', () => {
  it('accepts finite parser limits', () => {
    expect(
      ParserConfigSchema.safeParse({
        maxTextBytes: 1_000_000,
        maxPdfBytes: 10_000_000,
        maxDocxBytes: 10_000_000,
        pdfTimeoutMs: 10_000,
        maxPdfPages: 50,
        maxImagePixels: 16_777_216,
      }).success,
    ).toBe(true);
  });

  it('rejects unsafe parser limits', () => {
    expect(
      ParserConfigSchema.safeParse({
        maxTextBytes: 0,
        maxPdfBytes: Number.POSITIVE_INFINITY,
        maxDocxBytes: 0,
        pdfTimeoutMs: -1,
        maxPdfPages: 0,
        maxImagePixels: 0,
      }).success,
    ).toBe(false);
  });

  it('accepts canonical scoring configuration and rejects non-100 weights', () => {
    expect(ScoringConfigSchema.safeParse(scoringConfig).success).toBe(true);
    expect(
      ScoringConfigSchema.safeParse({
        ...scoringConfig,
        weights: { ...scoringConfig.weights, requiredTechnical: 34 },
      }).success,
    ).toBe(false);
  });
});

describe('AnalysisEnvelopeSchema', () => {
  const analysis = {
    schemaVersion: '1.0',
    id: 'analysis-1',
    overallScore: 100,
    recommendation: 'apply',
    confidence: 1,
    hardBlockers: [],
    matchedRequirements: [],
    missingRequirements: [],
    unsupportedClaims: [],
    suggestedEmphasis: [],
    suggestedAdditions: [],
    interviewTopics: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
    metadata: {
      mode: 'deterministic',
      engineVersion: '0.1.0',
      normalizationVersion: '1.0.0',
      scoringVersion: '1.0.0',
      parsing: {
        resumeConfidence: 1,
        jobConfidence: 1,
        warnings: [],
      },
    },
    scoreContributions: [],
  } as const;

  it('accepts a schema-versioned analysis envelope and inferred type', () => {
    const envelope = AnalysisEnvelopeSchema.parse({ schemaVersion: '1.0', analysis });

    expect(AnalysisResultSchema.safeParse(analysis).success).toBe(true);
    expectTypeOf(envelope).toEqualTypeOf<AnalysisEnvelope>();
  });

  it('rejects an unversioned or decorated envelope', () => {
    expect(AnalysisEnvelopeSchema.safeParse({ analysis }).success).toBe(false);
    expect(
      AnalysisEnvelopeSchema.safeParse({ schemaVersion: '1.0', analysis, log: 'complete' }).success,
    ).toBe(false);
  });
});

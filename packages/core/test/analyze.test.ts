import { describe, expect, it } from 'vitest';

import {
  AnalysisResultSchema,
  type CareerEvidence,
  type DeterministicAnalysisInput,
  type ParsedDocument,
} from '@roleproof/shared';

import {
  DEFAULT_NORMALIZATION_DATA,
  analyzeDeterministic,
  analyzeDeterministicWithEvidence,
  extractCareerEvidence,
} from '../src/index.js';

const resume: ParsedDocument = {
  schemaVersion: '1.0',
  id: 'resume-analysis',
  kind: 'resume',
  format: 'plaintext',
  text: `
Skills: TypeScript, Node.js, PostgreSQL, Docker, OAuth2
2020-2026: Built TypeScript REST APIs with Node.js and PostgreSQL.
Led an engineering team for a fictional product.
  `.trim(),
  confidence: 1,
  warnings: [],
};

const job: ParsedDocument = {
  schemaVersion: '1.0',
  id: 'job-analysis',
  kind: 'job',
  format: 'plaintext',
  text: `
Backend Engineer

Required Qualifications
- 5+ years TypeScript
- PostgreSQL
- OAuth2
- Backend development
- Kubernetes
- GraphQL

Responsibilities
- Team leadership
  `.trim(),
  confidence: 1,
  warnings: [],
};

const input: DeterministicAnalysisInput = {
  resume,
  job,
  candidateContext: {
    preferredLocations: [],
    clearances: [],
    licenses: [],
    education: [],
    certifications: [],
  },
};

describe('analyzeDeterministic', () => {
  it('produces a schema-valid, evidence-linked analysis', () => {
    const result = analyzeDeterministic(input, {
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(AnalysisResultSchema.safeParse(result).success).toBe(true);
    const direct = result.matchedRequirements.find((match) => match.classification === 'direct');
    const partial = result.matchedRequirements.find(
      (match) => match.classification === 'partially-related',
    );
    const unsupported = result.matchedRequirements.find(
      (match) => match.classification === 'unsupported',
    );
    expect(direct?.evidenceIds.length).toBeGreaterThan(0);
    expect(partial?.explanation).toContain('not direct experience');
    expect(unsupported?.evidenceIds).toEqual([]);
    expect(result.scoreContributions).not.toHaveLength(0);
    expect(result.unsupportedClaims).toHaveLength(1);
    expect(result.unsupportedClaims[0]?.text).toContain('GraphQL');
    expect(result.unsupportedClaims[0]?.classification).toBe('unsupported');
    expect(result.unsupportedClaims[0]?.evidenceIds).toEqual([]);
    expect(result.suggestedEmphasis.every((item) => item.evidenceIds.length > 0)).toBe(true);
    expect(result.metadata.engineVersion).toBe('0.5.0');
  });

  it('is deterministic for identical inputs and does not mutate them', () => {
    const inputSnapshot = structuredClone(input);
    const first = analyzeDeterministic(input, {
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    const second = analyzeDeterministic(input, {
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(second).toEqual(first);
    expect(input).toEqual(inputSnapshot);
  });

  it('includes an explicit parsing identity key in the stable analysis ID', () => {
    const generatedAt = '2026-01-01T00:00:00.000Z';
    const lowConfidence = analyzeDeterministic(input, {
      generatedAt,
      analysisIdentityKey: 'resume-confidence:0.5',
    });
    const highConfidence = analyzeDeterministic(input, {
      generatedAt,
      analysisIdentityKey: 'resume-confidence:1',
    });
    const repeated = analyzeDeterministic(input, {
      generatedAt,
      analysisIdentityKey: 'resume-confidence:0.5',
    });

    expect(highConfidence.id).not.toBe(lowConfidence.id);
    expect(repeated.id).toBe(lowConfidence.id);
  });

  it('uses manual review for low-confidence requirement extraction', () => {
    const ambiguousInput: DeterministicAnalysisInput = {
      ...input,
      job: {
        ...job,
        id: 'job-low-confidence',
        text: 'TypeScript may be required or preferred depending on the team.',
      },
    };

    const result = analyzeDeterministic(ambiguousInput, {
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.recommendation).toBe('manual-review');
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.metadata.parsing?.warnings).toContain(
      'Required versus preferred importance is ambiguous.',
    );
  });

  it('keeps hard blockers separate and forces a skip recommendation', () => {
    const blockedInput: DeterministicAnalysisInput = {
      ...input,
      job: {
        ...job,
        id: 'job-blocked-analysis',
        text: `${job.text}\nSalary: USD 80000-100000 annually.`,
      },
      candidateContext: {
        ...input.candidateContext,
        targetSalaryMin: 120_000,
      },
    };

    const result = analyzeDeterministic(blockedInput, {
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.recommendation).toBe('skip');
    expect(result.hardBlockers).toEqual([expect.stringContaining('Compensation maximum')]);
    expect(result.overallScore).toBeGreaterThan(0);
  });

  it('uses canonical explicit resume clearance facts for required-section eligibility', () => {
    const clearanceInput: DeterministicAnalysisInput = {
      ...input,
      resume: {
        ...resume,
        id: 'resume-clearance-analysis',
        text: `${resume.text}\nClearance: Public Trust, Active Secret`,
      },
      job: {
        ...job,
        id: 'job-clearance-analysis',
        text: 'Required Qualifications\n- Active Secret clearance',
      },
    };

    const result = analyzeDeterministic(clearanceInput, {
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.hardBlockers).toEqual([]);
    expect(result.missingRequirements).toEqual([]);
    expect(result.matchedRequirements).toEqual([
      expect.objectContaining({ classification: 'direct', evidenceIds: [expect.any(String)] }),
    ]);
    expect(result.overallScore).toBe(100);
    expect(result.recommendation).toBe('apply');
  });

  it('keeps a required clearance unknown when the candidate supplied no clearance fact', () => {
    const unknownClearanceInput: DeterministicAnalysisInput = {
      ...input,
      job: {
        ...job,
        id: 'job-unknown-clearance-analysis',
        text: 'Required Qualifications\n- Active Secret clearance',
      },
    };

    const result = analyzeDeterministic(unknownClearanceInput, {
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.hardBlockers).toEqual([]);
    expect(result.matchedRequirements).toEqual([
      expect.objectContaining({ classification: 'unknown', evidenceIds: [] }),
    ]);
    expect(result.unsupportedClaims).toEqual([]);
  });
});

describe('analyzeDeterministicWithEvidence', () => {
  const generatedAt = '2026-01-01T00:00:00.000Z';
  const profileId = 'profile-fictional';
  const suppliedEvidence = extractCareerEvidence(resume, DEFAULT_NORMALIZATION_DATA.aliases, {
    profileId,
  });

  it('uses caller-supplied evidence, reports its profile, and enforces profile ownership', () => {
    const result = analyzeDeterministicWithEvidence(
      { ...input, profileId, evidence: suppliedEvidence },
      { generatedAt },
    );

    expect(result.profileId).toBe(profileId);
    expect(() =>
      analyzeDeterministicWithEvidence({
        ...input,
        profileId,
        evidence: [{ ...suppliedEvidence[0]!, profileId: 'profile-other' }],
      }),
    ).toThrow();
    expect(
      analyzeDeterministicWithEvidence({ ...input, evidence: suppliedEvidence }, { generatedAt }),
    ).not.toHaveProperty('profileId');
  });

  it('includes sorted canonical evidence in its stable ID without mutating inputs', () => {
    const evidence = [...suppliedEvidence].reverse();
    const snapshot = structuredClone(evidence);
    const first = analyzeDeterministicWithEvidence(
      { ...input, profileId, evidence },
      { generatedAt },
    );
    const repeated = analyzeDeterministicWithEvidence(
      { ...input, profileId, evidence: [...evidence].reverse() },
      { generatedAt },
    );
    const edited = evidence.map((item, index): CareerEvidence =>
      index === 0 ? { ...item, description: `${item.description} Confirmed detail.` } : item,
    );

    expect(repeated).toEqual(first);
    expect(evidence).toEqual(snapshot);
    expect(
      analyzeDeterministicWithEvidence({ ...input, profileId, evidence: edited }, { generatedAt })
        .id,
    ).not.toBe(first.id);
  });

  it('preserves the existing scoring and hard-blocker pipeline', () => {
    const blockedInput: DeterministicAnalysisInput = {
      ...input,
      job: { ...job, text: `${job.text}\nSalary: USD 80000-100000 annually.` },
      candidateContext: { ...input.candidateContext, targetSalaryMin: 120_000 },
    };
    const legacy = analyzeDeterministic(blockedInput, { generatedAt });
    const evidenceAware = analyzeDeterministicWithEvidence(
      {
        ...blockedInput,
        evidence: extractCareerEvidence(blockedInput.resume, DEFAULT_NORMALIZATION_DATA.aliases),
      },
      { generatedAt },
    );

    expect(evidenceAware.overallScore).toBe(legacy.overallScore);
    expect(evidenceAware.scoreContributions).toEqual(legacy.scoreContributions);
    expect(evidenceAware.hardBlockers).toEqual(legacy.hardBlockers);
    expect(evidenceAware.recommendation).toBe('skip');
  });
});

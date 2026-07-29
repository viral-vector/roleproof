import { describe, expect, it } from 'vitest';

import type { ParsedDocument } from '@roleproof/shared';

import {
  DEFAULT_NORMALIZATION_DATA,
  MAX_ANALYZED_REQUIREMENTS,
  extractCareerEvidence,
  extractJobRequirements,
} from '../src/index.js';

const resume: ParsedDocument = {
  schemaVersion: '1.0',
  id: 'resume-fictional',
  kind: 'resume',
  format: 'plaintext',
  text: `
Skills: TS, Postgres, Docker
2020-2026: Built TypeScript REST APIs with Node.js.
Led an engineering team for a fictional product.
  `.trim(),
  confidence: 1,
  warnings: [],
};

const job: ParsedDocument = {
  schemaVersion: '1.0',
  id: 'job-fictional',
  kind: 'job',
  format: 'plaintext',
  text: `
Backend Engineer

Required Qualifications
- 5+ years of TypeScript
- PostgreSQL

Responsibilities
- Team leadership
- Backend development

Preferred Qualifications
- Kubernetes
  `.trim(),
  confidence: 1,
  warnings: [],
};

describe('extractCareerEvidence', () => {
  it('extracts explicit normalized evidence with source lines and stable IDs', () => {
    const first = extractCareerEvidence(resume, DEFAULT_NORMALIZATION_DATA.aliases);
    const second = extractCareerEvidence(resume, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(second).toEqual(first);
    const typescript = first.find(
      (item) => item.normalizedName === 'TypeScript' && item.startDate === '2020',
    );
    const leadership = first.find((item) => item.normalizedName === 'Team leadership');
    expect(typescript?.category).toBe('skill');
    expect(typescript?.normalizedName).toBe('TypeScript');
    expect(typescript?.startDate).toBe('2020');
    expect(typescript?.endDate).toBe('2026');
    expect(typescript?.confidence).toBe('explicit');
    expect(typescript?.sourceText).toContain('Built TypeScript REST APIs');
    expect(leadership?.category).toBe('leadership');
    expect(leadership?.sourceText).toBe('Led an engineering team for a fictional product.');
  });

  it('assigns extracted evidence to an explicitly supplied profile', () => {
    const evidence = extractCareerEvidence(resume, DEFAULT_NORMALIZATION_DATA.aliases, {
      profileId: 'profile-imported',
    });

    expect(evidence).not.toHaveLength(0);
    expect(evidence.every((item) => item.profileId === 'profile-imported')).toBe(true);
    expect(
      extractCareerEvidence(resume, DEFAULT_NORMALIZATION_DATA.aliases).every(
        (item) => item.profileId === 'profile-local',
      ),
    ).toBe(true);
  });

  it('does not invent dates when a source line has none', () => {
    const evidence = extractCareerEvidence(resume, DEFAULT_NORMALIZATION_DATA.aliases);
    const docker = evidence.find(
      (item) =>
        item.normalizedName === 'Docker' && item.sourceText === 'Skills: TS, Postgres, Docker',
    );

    expect(docker).toBeDefined();
    expect(docker).not.toHaveProperty('startDate');
    expect(docker).not.toHaveProperty('endDate');
  });

  it('does not convert negated experience into explicit evidence', () => {
    const negatedResume: ParsedDocument = {
      ...resume,
      id: 'resume-negated',
      text: 'No TypeScript experience.\nWorked without PostgreSQL.',
    };

    const evidence = extractCareerEvidence(negatedResume, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(evidence).toEqual([]);
  });

  it('does not convert learning or postfixed disclaimers into experience evidence', () => {
    const learningResume: ParsedDocument = {
      ...resume,
      id: 'resume-learning',
      text: [
        '2020-2026: Worked in sales and am currently learning TypeScript.',
        'PostgreSQL experience: none.',
        '2020-2026: Built Node.js services. Learned Docker in 2026.',
      ].join('\n'),
    };

    const evidence = extractCareerEvidence(learningResume, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(evidence.map((item) => item.normalizedName)).toEqual(['Node.js']);
    expect(evidence[0]).toEqual(expect.objectContaining({ startDate: '2020', endDate: '2026' }));
  });

  it('does not credit never-used claims or broad dates before a later skill start', () => {
    const qualifiedResume: ParsedDocument = {
      ...resume,
      id: 'resume-qualified-claims',
      text: [
        'I have never worked with TypeScript.',
        'PostgreSQL (never used professionally).',
        'Docker, never used professionally.',
        'Docker, which I never used professionally.',
        'Objective: Seeking a TypeScript role.',
        '2020-2026: Worked in sales and started using Node.js in 2025.',
        '2020-2026: Worked in sales and used OAuth2 since 2025.',
        '2020-2026: Worked in sales and used REST API from 2025.',
        '2016-2024: Built services and in 2023 used Go.',
      ].join('\n'),
    };

    const evidence = extractCareerEvidence(qualifiedResume, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(evidence.map((item) => item.normalizedName).sort()).toEqual([
      'Go',
      'Node.js',
      'OAuth2',
      'REST API',
    ]);
    expect(evidence.find((item) => item.normalizedName === 'Go')?.startDate).toBe('2023');
    expect(
      evidence
        .filter((item) => item.normalizedName !== 'Go')
        .every((item) => item.startDate === '2025'),
    ).toBe(true);
    expect(evidence.every((item) => item.endDate === undefined)).toBe(true);
  });

  it('requires affirmative context for each mention while accepting common skill claims', () => {
    const contextResume: ParsedDocument = {
      ...resume,
      id: 'resume-clause-context',
      text: [
        'Seeking TypeScript roles; built JavaScript services.',
        'Technical Skills',
        'PostgreSQL',
        'Summary: Proficient in Docker.',
        'Supported the Go team without writing or deploying Go software.',
        'Skills',
        'TypeScript',
        'Interests: Go',
      ].join('\n'),
    };

    const evidence = extractCareerEvidence(contextResume, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(evidence.map((item) => item.normalizedName).sort()).toEqual([
      'Docker',
      'JavaScript',
      'PostgreSQL',
      'TypeScript',
    ]);
  });
});

describe('extractJobRequirements', () => {
  it('extracts required, preferred, responsibility, and years contracts', () => {
    const extraction = extractJobRequirements(job, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(extraction.confidence).toBe(1);
    expect(extraction.hasConflicts).toBe(false);
    expect(extraction.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: 'TypeScript',
          importance: 'required',
          yearsRequested: 5,
        }),
        expect.objectContaining({
          normalizedName: 'PostgreSQL',
          importance: 'required',
        }),
        expect.objectContaining({
          normalizedName: 'Team leadership',
          importance: 'required',
        }),
        expect.objectContaining({
          normalizedName: 'Backend development',
          importance: 'required',
        }),
        expect.objectContaining({
          normalizedName: 'Kubernetes',
          importance: 'preferred',
        }),
      ]),
    );
  });

  it('binds each requested duration to its own skill mention', () => {
    const durationJob: ParsedDocument = {
      ...job,
      id: 'job-skill-durations',
      text: 'Required Qualifications\n- 2+ years TypeScript and 5+ years Go',
    };

    const extraction = extractJobRequirements(durationJob, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(extraction.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ normalizedName: 'TypeScript', yearsRequested: 2 }),
        expect.objectContaining({ normalizedName: 'Go', yearsRequested: 5 }),
      ]),
    );

    const suffixJob: ParsedDocument = {
      ...durationJob,
      id: 'job-suffix-skill-durations',
      text: 'Required Qualifications\n- TypeScript: 2+ years and Go: 5+ years',
    };
    const suffixExtraction = extractJobRequirements(suffixJob, DEFAULT_NORMALIZATION_DATA.aliases);
    expect(suffixExtraction.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ normalizedName: 'TypeScript', yearsRequested: 2 }),
        expect.objectContaining({ normalizedName: 'Go', yearsRequested: 5 }),
      ]),
    );
  });

  it('deduplicates repeated evidence and requirements by stable semantic identity', () => {
    const repeatedResume: ParsedDocument = {
      ...resume,
      id: 'resume-repeated-evidence',
      text: Array.from({ length: 20 }, () => 'Built TypeScript services.').join('\n'),
    };
    const repeatedJob: ParsedDocument = {
      ...job,
      id: 'job-repeated-requirement',
      text: `Required Qualifications\n${Array.from({ length: 20 }, () => '- TypeScript').join('\n')}`,
    };

    expect(extractCareerEvidence(repeatedResume, DEFAULT_NORMALIZATION_DATA.aliases)).toHaveLength(
      1,
    );
    expect(
      extractJobRequirements(repeatedJob, DEFAULT_NORMALIZATION_DATA.aliases).requirements,
    ).toHaveLength(1);

    const durationJob: ParsedDocument = {
      ...job,
      id: 'job-repeated-duration-requirements',
      text: 'Required Qualifications\n- 2+ years TypeScript\n- 5+ years TypeScript',
    };
    expect(
      extractJobRequirements(durationJob, DEFAULT_NORMALIZATION_DATA.aliases).requirements,
    ).toEqual([expect.objectContaining({ normalizedName: 'TypeScript', yearsRequested: 5 })]);
  });

  it('bounds aggregate requirements and lowers confidence for manual review', () => {
    const largeJob: ParsedDocument = {
      ...job,
      id: 'job-requirement-limit',
      text: `Required Qualifications\n${Array.from({ length: MAX_ANALYZED_REQUIREMENTS + 1 }, (_, index) => `- Fictional capability ${index}`).join('\n')}`,
    };

    const extraction = extractJobRequirements(largeJob, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(extraction.requirements).toHaveLength(MAX_ANALYZED_REQUIREMENTS);
    expect(extraction.confidence).toBeLessThan(0.6);
    expect(extraction.warnings).toContain(
      `Requirement count exceeds the ${MAX_ANALYZED_REQUIREMENTS}-item analysis limit.`,
    );
  });

  it('preserves conflicting importance and lowers confidence without clear headings', () => {
    const ambiguousJob: ParsedDocument = {
      ...job,
      id: 'job-ambiguous',
      text: 'TypeScript may be useful.\nTypeScript is required or preferred depending on the team.',
    };

    const extraction = extractJobRequirements(ambiguousJob, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(extraction.confidence).toBeLessThan(0.6);
    expect(extraction.hasConflicts).toBe(true);
    expect(extraction.warnings).toContain('Required versus preferred importance is ambiguous.');
    expect(
      extraction.requirements.filter((item) => item.normalizedName === 'TypeScript'),
    ).toHaveLength(2);
  });

  it('preserves unknown mandatory requirements instead of dropping them', () => {
    const unknownSkillJob: ParsedDocument = {
      ...job,
      id: 'job-unknown-skill',
      text: 'Required Qualifications\n- TypeScript\n- Rust',
    };

    const extraction = extractJobRequirements(unknownSkillJob, DEFAULT_NORMALIZATION_DATA.aliases);

    const rust = extraction.requirements.find((item) => item.text === 'Rust');
    expect(rust?.importance).toBe('required');
    expect(rust?.normalizedName).toBeUndefined();
  });

  it('does not promote explicitly non-required wording to mandatory', () => {
    const negatedJob: ParsedDocument = {
      ...job,
      id: 'job-negated-requirement',
      text: 'TypeScript is not required.',
    };

    const extraction = extractJobRequirements(negatedJob, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(extraction.requirements).toHaveLength(1);
    expect(extraction.requirements[0]?.normalizedName).toBe('TypeScript');
    expect(extraction.requirements[0]?.importance).toBe('contextual');
  });

  it('classifies generic eligibility requirements for scoring and review', () => {
    const clearanceJob: ParsedDocument = {
      ...job,
      id: 'job-clearance-requirement',
      text: 'An active Secret clearance is required.',
    };

    const extraction = extractJobRequirements(clearanceJob, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(extraction.requirements).toHaveLength(1);
    expect(extraction.requirements[0]?.category).toBe('clearance');
    expect(extraction.requirements[0]?.importance).toBe('required');
  });

  it('preserves eligibility requirements that share a clause with a known skill', () => {
    const mixedJob: ParsedDocument = {
      ...job,
      id: 'job-mixed-clearance-skill',
      text: 'Required Qualifications\n- AWS experience and an active Secret clearance',
    };

    const extraction = extractJobRequirements(mixedJob, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(extraction.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'infrastructure', normalizedName: 'AWS' }),
        expect.objectContaining({ category: 'clearance', importance: 'required' }),
      ]),
    );
  });

  it('ends qualification sections before compensation and benefits metadata', () => {
    const metadataJob: ParsedDocument = {
      ...job,
      id: 'job-section-metadata',
      text: [
        'Required Qualifications',
        '- Rust',
        'Salary: USD 120000-150000 annually',
        'Benefits',
        '- Unlimited PTO',
      ].join('\n'),
    };

    const extraction = extractJobRequirements(metadataJob, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(extraction.requirements).toHaveLength(1);
    expect(extraction.requirements[0]).toEqual(
      expect.objectContaining({ text: 'Rust', importance: 'required' }),
    );
  });

  it('ends qualification sections at common offer headings and salary sentences', () => {
    const offerJob: ParsedDocument = {
      ...job,
      id: 'job-offer-section',
      text: [
        'Required Qualifications',
        '- TypeScript',
        'What We Offer',
        '- Unlimited PTO',
        'The salary range is USD 120000-150000 annually.',
      ].join('\n'),
    };

    const extraction = extractJobRequirements(offerJob, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(extraction.requirements).toHaveLength(1);
    expect(extraction.requirements[0]?.normalizedName).toBe('TypeScript');
  });

  it('detects conflicting importance for unnormalized requirements', () => {
    const conflictingJob: ParsedDocument = {
      ...job,
      id: 'job-rust-conflict',
      text: 'Rust is required.\nRust is preferred.',
    };

    const extraction = extractJobRequirements(conflictingJob, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(extraction.hasConflicts).toBe(true);
    expect(extraction.confidence).toBeLessThan(0.6);
  });

  it('does not split a compound responsibility into a generic requirement', () => {
    const compoundJob: ParsedDocument = {
      ...job,
      id: 'job-compound-responsibility',
      text: 'Design and implement TypeScript systems is required.',
    };

    const extraction = extractJobRequirements(compoundJob, DEFAULT_NORMALIZATION_DATA.aliases);

    expect(extraction.requirements).toHaveLength(1);
    expect(extraction.requirements[0]?.normalizedName).toBe('TypeScript');
  });
});

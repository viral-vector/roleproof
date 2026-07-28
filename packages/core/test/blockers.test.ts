import { describe, expect, it } from 'vitest';

import type { CandidateContext, ParsedDocument } from '@roleproof/shared';

import {
  DEFAULT_NORMALIZATION_DATA,
  detectHardBlockers,
  extractJobRequirements,
} from '../src/index.js';

const emptyContext: CandidateContext = {
  preferredLocations: [],
  clearances: [],
  licenses: [],
  education: [],
  certifications: [],
};

function job(text: string): ParsedDocument {
  return {
    schemaVersion: '1.0',
    id: 'job-blocker',
    kind: 'job',
    format: 'plaintext',
    text,
    confidence: 1,
    warnings: [],
  };
}

function detect(text: string, context: CandidateContext): string[] {
  const document = job(text);
  const extraction = extractJobRequirements(document, DEFAULT_NORMALIZATION_DATA.aliases);
  return detectHardBlockers(document, context, extraction.requirements);
}

const blockerCases: Array<[string, CandidateContext, string]> = [
  [
    'Candidates must be authorized to work in the US without sponsorship.',
    { ...emptyContext, workAuthorization: 'Requires sponsorship' },
    'Work authorization',
  ],
  [
    'An active Secret clearance is required.',
    { ...emptyContext, clearances: ['Public Trust'] },
    'clearance',
  ],
  [
    'A Professional Engineer license is required.',
    { ...emptyContext, licenses: ['None'] },
    'license',
  ],
  [
    'This role requires a master degree in computer science.',
    { ...emptyContext, education: ['Bachelor degree'] },
    'degree',
  ],
  [
    'Onsite in Austin, TX is required.',
    { ...emptyContext, preferredLocations: ['Denver, CO'], remotePreference: 'onsite' },
    'location',
  ],
  [
    'Salary: USD 80000-100000 annually.',
    { ...emptyContext, targetSalaryMin: 120_000 },
    'Compensation maximum',
  ],
];

describe('detectHardBlockers', () => {
  it.each(blockerCases)('detects an explicit mismatch: %s', (text, context, expected) => {
    expect(detectHardBlockers(job(text), context)).toEqual([expect.stringContaining(expected)]);
  });

  it('does not turn missing candidate facts into blockers', () => {
    const role = job(`
An active Secret clearance is required.
Candidates must be authorized without sponsorship.
Onsite in Austin, TX is required.
    `);

    expect(detectHardBlockers(role, emptyContext)).toEqual([]);
  });

  it('does not turn preferred qualifications into blockers', () => {
    const role = job(`
Secret clearance preferred.
Professional Engineer license is a plus.
Master degree preferred.
    `);
    const context: CandidateContext = {
      ...emptyContext,
      clearances: ['None'],
      licenses: ['None'],
      education: ['Bachelor degree'],
    };

    expect(detectHardBlockers(role, context)).toEqual([]);
  });

  it('does not treat a negated clearance requirement as mandatory', () => {
    expect(
      detectHardBlockers(job('No Secret clearance is required.'), {
        ...emptyContext,
        clearances: ['None'],
      }),
    ).toEqual([]);
  });

  it('compares clearance levels exactly rather than by substring', () => {
    expect(
      detectHardBlockers(job('An active Top Secret clearance is required.'), {
        ...emptyContext,
        clearances: ['Secret'],
      }),
    ).toEqual([expect.stringContaining('clearance')]);
  });

  it('does not compare hourly compensation with an annual target', () => {
    expect(
      detectHardBlockers(job('Salary: USD 40-50 hourly.'), {
        ...emptyContext,
        targetSalaryMin: 120_000,
      }),
    ).toEqual([]);
  });

  it('honors mandatory qualification headings and clause-local negation', () => {
    expect(
      detect(
        [
          'Required Qualifications',
          '- No degree is required, but an active Secret clearance is mandatory.',
        ].join('\n'),
        {
          ...emptyContext,
          clearances: ['Public Trust'],
          education: ['High school diploma'],
        },
      ),
    ).toEqual([expect.stringContaining('clearance')]);
  });

  it.each([
    'No degree is required; an active Secret clearance is mandatory.',
    'No degree is required and an active Secret clearance is mandatory.',
  ])('keeps independent mandatory clauses after negation: %s', (qualification) => {
    expect(
      detect(`Required Qualifications\n- ${qualification}`, {
        ...emptyContext,
        clearances: ['Public Trust'],
        education: ['High school diploma'],
      }),
    ).toEqual([expect.stringContaining('clearance')]);
  });

  it('canonicalizes decorated and comma-separated clearance values exactly', () => {
    expect(
      detect('An active Secret clearance is required.', {
        ...emptyContext,
        clearances: ['Public Trust, Active Secret'],
      }),
    ).toEqual([]);
    expect(
      detect('An active Top Secret clearance is required.', {
        ...emptyContext,
        clearances: ['Public Trust, Active Secret'],
      }),
    ).toEqual([expect.stringContaining('clearance')]);
  });

  it('supports clearance alternatives without dropping material status qualifiers', () => {
    expect(
      detect('A Secret or Top Secret clearance is required.', {
        ...emptyContext,
        clearances: ['Active Top Secret'],
      }),
    ).toEqual([]);
    expect(
      detect('An active Secret clearance is required.', {
        ...emptyContext,
        clearances: ['Former Secret'],
      }),
    ).toEqual([expect.stringContaining('clearance')]);
    expect(
      detect('A Top Secret/SCI clearance is required.', {
        ...emptyContext,
        clearances: ['Top Secret without SCI'],
      }),
    ).toEqual([expect.stringContaining('clearance')]);
  });

  it('does not treat negated holdings or eligibility as a held clearance', () => {
    expect(
      detect('An active Secret clearance is required.', {
        ...emptyContext,
        clearances: ['No active Secret clearance'],
      }),
    ).toEqual([expect.stringContaining('clearance')]);
    expect(
      detect('A Secret clearance is required.', {
        ...emptyContext,
        clearances: ['No Secret clearance'],
      }),
    ).toEqual([expect.stringContaining('clearance')]);
    expect(
      detect('A Top Secret/SCI clearance is required.', {
        ...emptyContext,
        clearances: ['Top Secret SCI eligible'],
      }),
    ).toEqual([]);
    for (const clearance of [
      'Without Secret clearance',
      "Doesn't hold Secret clearance",
      'Secret clearance not currently held',
    ]) {
      expect(
        detect('A Secret clearance is required.', {
          ...emptyContext,
          clearances: [clearance],
        }),
      ).toEqual([expect.stringContaining('clearance')]);
    }
  });

  it('evaluates every mandatory requirement in an eligibility category', () => {
    expect(
      detect(
        ['Required Qualifications', '- Security guard license', '- Commercial driver license'].join(
          '\n',
        ),
        { ...emptyContext, licenses: ['Security guard'] },
      ),
    ).toEqual([expect.stringContaining('license')]);
    expect(
      detect('A Commercial pilot license with experience is required.', {
        ...emptyContext,
        licenses: ['PE'],
      }),
    ).toEqual([expect.stringContaining('license')]);
  });

  it('normalizes degree levels and does not block explicit experience alternatives', () => {
    expect(
      detect('A Bachelor degree in computer science is required.', {
        ...emptyContext,
        education: ['Bachelor of Science in Computer Science'],
      }),
    ).toEqual([]);
    expect(
      detect('A Bachelor degree in computer science or equivalent experience is required.', {
        ...emptyContext,
        education: ['High school diploma'],
      }),
    ).toEqual([]);
  });

  it('detects explicit location mismatches across mandatory onsite wording', () => {
    expect(
      detect('Must work onsite in Austin', {
        ...emptyContext,
        preferredLocations: ['Denver'],
        remotePreference: 'onsite',
      }),
    ).toEqual([expect.stringContaining('location')]);
  });

  it('associates each compensation range with its own unit and base-pay type', () => {
    expect(
      detect('Base pay is USD 40-50 hourly with an annual bonus of USD 5000-10000.', {
        ...emptyContext,
        targetSalaryMin: 120_000,
      }),
    ).toEqual([]);
    expect(
      detect('Salary: USD 80k-100k annually.', {
        ...emptyContext,
        targetSalaryMin: 120_000,
      }),
    ).toEqual([expect.stringContaining('Compensation maximum 100000')]);
    expect(
      detect('Salary: USD 80000-100000 a year.', {
        ...emptyContext,
        targetSalaryMin: 120_000,
      }),
    ).toEqual([expect.stringContaining('Compensation maximum 100000')]);
    expect(
      detect('Salary: USD 150000-100000 annually.', {
        ...emptyContext,
        targetSalaryMin: 120_000,
      }),
    ).toEqual([]);
  });

  it('keeps an annual base range when the same line also states a bonus range', () => {
    expect(
      detect('Annual base salary is USD 80k-100k and annual bonus is USD 5k-10k.', {
        ...emptyContext,
        targetSalaryMin: 120_000,
      }),
    ).toEqual([expect.stringContaining('Compensation maximum 100000')]);
    expect(
      detect('Annual base salary is USD 80k-100k and a target annual bonus is USD 5k-10k.', {
        ...emptyContext,
        targetSalaryMin: 120_000,
      }),
    ).toEqual([expect.stringContaining('Compensation maximum 100000')]);
    expect(
      detect(
        'Annual base salary is USD 80k-100k and participates in a discretionary annual incentive bonus program of USD 5k-10k.',
        {
          ...emptyContext,
          targetSalaryMin: 120_000,
        },
      ),
    ).toEqual([expect.stringContaining('Compensation maximum 100000')]);
    for (const compensation of [
      'Annual base salary is USD 80k-100k, annual bonus is USD 5k-10k.',
      'Annual base salary is USD 80k-100k. Annual bonus is USD 5k-10k.',
    ]) {
      expect(
        detect(compensation, {
          ...emptyContext,
          targetSalaryMin: 120_000,
        }),
      ).toEqual([expect.stringContaining('Compensation maximum 100000')]);
    }
  });
});

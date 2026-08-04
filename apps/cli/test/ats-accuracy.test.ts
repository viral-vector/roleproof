import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_NORMALIZATION_DATA,
  analyzeDeterministic,
  extractJobRequirements,
} from '@roleproof/core';
import { extractJobPageTextWithProvenance, parseJobUrlWithMetadata } from '@roleproof/parsers';
import type { CandidateContext, DeterministicAnalysisInput } from '@roleproof/shared';

const fixtureRoot = new URL('../../../fixtures/ats/', import.meta.url);

const corpus = [
  {
    name: 'greenhouse',
    url: 'https://job-boards.greenhouse.io/fictionalco/jobs/123',
    method: 'container',
    atsProvider: 'greenhouse',
  },
  {
    name: 'lever',
    url: 'https://jobs.lever.co/fictionalco/abc123',
    method: 'container',
    atsProvider: 'lever',
  },
  {
    name: 'ashby',
    url: 'https://jobs.ashbyhq.com/fictionalco/abc123',
    method: 'container',
    atsProvider: 'ashby',
  },
  {
    name: 'workday',
    url: 'https://fictionalco.wd1.myworkdayjobs.com/en-US/External/job/Senior-Backend-Engineer_123',
    method: 'json-ld',
    atsProvider: 'workday',
  },
  {
    name: 'icims',
    url: 'https://careers-fictionalco.icims.com/jobs/123/senior-backend-engineer/job',
    method: 'container',
    atsProvider: 'icims',
  },
  {
    name: 'generic',
    url: 'https://careers.fictional.example/jobs/senior-backend-engineer',
    method: 'fallback',
    atsProvider: 'unknown',
  },
] as const;

const chrome = [
  'First Name',
  'preferred programming language',
  'Similar jobs',
  'navigation',
  'Browse all fictional jobs',
  'Share this job',
  'Privacy',
  'equal opportunity',
  'application shell',
];

const candidateContext: CandidateContext = {
  preferredLocations: [],
  clearances: [],
  licenses: [],
  education: [],
  certifications: [],
  workAuthorization: 'Requires sponsorship',
};

function mockFetch(html: string): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  ) as unknown as typeof fetch;
}

async function analyzeFixture(name: string, url: string, resumeText: string) {
  const html = await readFile(new URL(`${name}.html`, fixtureRoot), 'utf8');
  const parsed = await parseJobUrlWithMetadata(url, {}, mockFetch(html));
  const input: DeterministicAnalysisInput = {
    resume: {
      schemaVersion: '1.0',
      id: 'resume-ats-corpus',
      kind: 'resume',
      format: 'plaintext',
      text: resumeText.trim(),
      confidence: 1,
      warnings: [],
    },
    job: parsed.document,
    candidateContext,
  };
  const analysis = analyzeDeterministic(input, { generatedAt: '2026-01-01T00:00:00.000Z' });
  const requirements = extractJobRequirements(
    parsed.document,
    DEFAULT_NORMALIZATION_DATA.aliases,
  ).requirements;
  return { analysis, html, parsed, requirements, url };
}

function requirementSignature(
  requirements: Awaited<ReturnType<typeof analyzeFixture>>['requirements'],
): string[] {
  return requirements
    .map((requirement) =>
      [
        requirement.category,
        requirement.importance,
        requirement.normalizedName ?? '<unnamed>',
      ].join('|'),
    )
    .sort();
}

describe('ATS accuracy corpus', () => {
  it.each(corpus)(
    'extracts the same posting from %s without page chrome',
    async ({ name, url }) => {
      const resumeText = await readFile(new URL('resume.txt', fixtureRoot), 'utf8');
      const { parsed, requirements } = await analyzeFixture(name, url, resumeText);

      for (const text of chrome) {
        expect(parsed.document.text).not.toContain(text);
      }
      expect(parsed.document.text).toContain('Senior Backend Engineer');
      expect(requirementSignature(requirements)).toEqual([
        'authorization|required|<unnamed>',
        'database|required|PostgreSQL',
        'framework|required|Node.js',
        'language|required|TypeScript',
      ]);
    },
  );

  it('produces identical matches, blockers, and recommendations across all platforms', async () => {
    const resumeText = await readFile(new URL('resume.txt', fixtureRoot), 'utf8');
    const results = await Promise.all(
      corpus.map(({ name, url }) => analyzeFixture(name, url, resumeText)),
    );

    const signatures = results.map(({ analysis }) => ({
      blockers: analysis.hardBlockers,
      classifications: analysis.matchedRequirements.map((match) => match.classification).sort(),
      recommendation: analysis.recommendation,
      unsupported: analysis.unsupportedClaims,
    }));
    for (const signature of signatures) {
      expect(signature).toEqual(signatures[0]);
    }

    const [first] = results;
    expect(first?.analysis.recommendation).toBe('skip');
    expect(first?.analysis.hardBlockers).toEqual([
      expect.stringContaining('Work authorization mismatch'),
    ]);
    expect(first?.analysis.matchedRequirements.map((match) => match.classification).sort()).toEqual(
      ['direct', 'direct', 'direct', 'unknown'],
    );
    expect(first?.analysis.unsupportedClaims).toEqual([]);
  });

  it.each(corpus)(
    'reports %s extraction provenance and ATS provider',
    async ({ name, url, method, atsProvider }) => {
      const resumeText = await readFile(new URL('resume.txt', fixtureRoot), 'utf8');
      const { html, parsed } = await analyzeFixture(name, url, resumeText);

      expect(extractJobPageTextWithProvenance(html, url).method).toBe(method);
      expect(parsed.source.atsProvider).toBe(atsProvider);
      const warningCodes = parsed.source.warnings.map((warning) => warning.code);
      if (method === 'fallback') {
        expect(warningCodes).toContain('generic-extraction');
      } else {
        expect(warningCodes).not.toContain('generic-extraction');
        expect(warningCodes).not.toContain('semantic-extraction');
      }
    },
  );
});

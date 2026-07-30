import { describe, expect, it } from 'vitest';

import { analyzeLocal, getHealth } from '../src/client/api/client.js';

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

const fetchStub = (
  response: Response,
): { calls: Array<Parameters<typeof fetch>>; fetchImpl: typeof fetch } => {
  const calls: Array<Parameters<typeof fetch>> = [];
  return {
    calls,
    fetchImpl(input, init) {
      calls.push([input, init]);
      return Promise.resolve(response);
    },
  };
};

describe('client API contract', () => {
  it('validates local health responses', async () => {
    const { calls, fetchImpl } = fetchStub(
      jsonResponse({
        schemaVersion: '1.0',
        status: 'ok',
        mode: 'local',
        accountRequired: false,
        cloudRequired: false,
      }),
    );

    await expect(getHealth(fetchImpl)).resolves.toEqual({
      schemaVersion: '1.0',
      status: 'ok',
      mode: 'local',
      accountRequired: false,
      cloudRequired: false,
    });
    expect(calls).toEqual([['/api/health', undefined]]);
  });

  it('posts deterministic analyze requests and validates the analysis envelope', async () => {
    const { calls, fetchImpl } = fetchStub(
      jsonResponse({
        schemaVersion: '1.0',
        analysis: {
          schemaVersion: '1.0',
          id: 'analysis-client-api',
          overallScore: 50,
          recommendation: 'stretch',
          confidence: 0.75,
          hardBlockers: [],
          matchedRequirements: [],
          missingRequirements: [],
          unsupportedClaims: [],
          suggestedEmphasis: [],
          suggestedAdditions: [],
          interviewTopics: [],
          generatedAt: '2026-01-01T00:00:00.000Z',
          metadata: { mode: 'deterministic', engineVersion: '0.3.0' },
        },
      }),
    );

    const result = await analyzeLocal(
      { resumeText: 'Fictional resume text', jobText: 'Fictional job text' },
      fetchImpl,
    );

    expect(result.analysis.recommendation).toBe('stretch');
    const [url, init] = calls[0]!;
    expect(url).toBe('/api/analyze');
    expect(init).toBeDefined();
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } });
    const body = init?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({
      schemaVersion: '1.0',
      mode: 'deterministic',
      resumeText: 'Fictional resume text',
      jobText: 'Fictional job text',
    });
  });

  it('returns content-free errors for failed analyze requests', async () => {
    const { fetchImpl } = fetchStub(jsonResponse({ error: 'PRIVATE CONTENT' }, { status: 400 }));

    await expect(
      analyzeLocal({ resumeText: '   ', jobText: 'Required: TypeScript' }, fetchImpl),
    ).rejects.toThrow('Analysis request failed. Check the supplied text.');
  });
});

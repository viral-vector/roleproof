import { describe, expect, it } from 'vitest';

import { analyzeLocal, getHealth, parseResumeFile } from '../src/client/api/client.js';

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

  it('uploads a selected resume only when parsing is explicitly requested', async () => {
    const { calls, fetchImpl } = fetchStub(
      jsonResponse({
        schemaVersion: '1.0',
        text: 'Fictional TypeScript experience.',
        format: 'plaintext',
        warnings: [],
      }),
    );
    const file = new File(['Fictional TypeScript experience.'], 'fictional resume.txt', {
      type: 'text/plain',
    });

    await expect(parseResumeFile(file, fetchImpl)).resolves.toMatchObject({ format: 'plaintext' });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe('/api/resume/parse');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get('resume')).toBe(file);
  });

  it('uploads a DOCX resume only when parsing is explicitly requested', async () => {
    const { calls, fetchImpl } = fetchStub(
      jsonResponse({
        schemaVersion: '1.0',
        text: 'Fictional TypeScript experience.',
        format: 'docx',
        warnings: [],
      }),
    );
    const file = new File(['Fictional TypeScript experience.'], 'fictional resume.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    await expect(parseResumeFile(file, fetchImpl)).resolves.toMatchObject({ format: 'docx' });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe('/api/resume/parse');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get('resume')).toBe(file);
  });

  it('rejects unsupported resume files before making a local request', async () => {
    const { calls, fetchImpl } = fetchStub(jsonResponse({ error: 'not used' }));
    const file = new File(['PRIVATE CONTENT'], 'resume.rtf');

    await expect(parseResumeFile(file, fetchImpl)).rejects.toThrow(
      'Resume file must be plaintext, PDF, or DOCX.',
    );
    expect(calls).toHaveLength(0);
  });

  it('rejects oversized DOCX resumes before making a local request', async () => {
    const { calls, fetchImpl } = fetchStub(jsonResponse({ error: 'not used' }));
    const file = new File([new Uint8Array(10_000_001)], 'fictional resume.docx');

    await expect(parseResumeFile(file, fetchImpl)).rejects.toThrow(
      'Resume file is empty or exceeds the parser size limit.',
    );
    expect(calls).toHaveLength(0);
  });

  it('maps a content-free server reason code to an actionable message', async () => {
    const { fetchImpl } = fetchStub(
      jsonResponse({ error: 'Invalid resume file.', code: 'docx-error' }, { status: 400 }),
    );
    const file = new File(['PRIVATE MALFORMED DOCX'], 'fictional resume.docx');

    await expect(parseResumeFile(file, fetchImpl)).rejects.toThrow(
      /The DOCX file could not be read. Re-save it/,
    );
  });

  it('keeps a generic message when the error body has no reason code', async () => {
    const { fetchImpl } = fetchStub(
      jsonResponse({ error: 'Invalid resume file.' }, { status: 400 }),
    );
    const file = new File(['PRIVATE CONTENT'], 'fictional resume.docx');

    await expect(parseResumeFile(file, fetchImpl)).rejects.toThrow(
      /could not be parsed. Check that the file is a valid TXT, PDF, or DOCX/,
    );
  });

  it('identifies a stale local server when the resume parse route is missing', async () => {
    const { fetchImpl } = fetchStub(jsonResponse({ error: 'Not Found' }, { status: 404 }));
    const file = new File(['Fictional content'], 'fictional resume.pdf', {
      type: 'application/pdf',
    });

    await expect(parseResumeFile(file, fetchImpl)).rejects.toThrow(
      'Local server is out of date. Restart RoleProof and try again.',
    );
  });
});

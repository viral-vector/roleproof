import { describe, expect, it } from 'vitest';

import {
  analyzeLocal,
  analyzeLocalStream,
  deleteProviderCredential,
  deleteHistoryItem,
  getProviderCredentialStatus,
  getHealth,
  getHistoryItem,
  getSettings,
  listHistory,
  listProviderModels,
  parseResumeFile,
  saveProviderCredential,
  updateSettings,
} from '../src/client/api/client.js';

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

  it('posts AI-enhanced analyze requests only with explicit transmission confirmation', async () => {
    const { calls, fetchImpl } = fetchStub(
      jsonResponse({
        schemaVersion: '1.0',
        analysis: {
          schemaVersion: '1.0',
          id: 'analysis-client-ai-fallback',
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

    await analyzeLocal(
      {
        resumeText: 'Fictional resume text',
        jobText: 'Fictional job text',
        mode: 'ai-enhanced',
        confirmProviderTransmission: true,
      },
      fetchImpl,
    );

    const body = calls[0]?.[1]?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({
      schemaVersion: '1.0',
      mode: 'ai-enhanced',
      confirmProviderTransmission: true,
      resumeText: 'Fictional resume text',
      jobText: 'Fictional job text',
    });
  });

  it('rejects AI-enhanced analyze requests without confirmation before posting content', async () => {
    const { calls, fetchImpl } = fetchStub(jsonResponse({ schemaVersion: '1.0' }));

    await expect(
      analyzeLocal(
        {
          resumeText: 'Fictional resume text',
          jobText: 'Fictional job text',
          mode: 'ai-enhanced',
          confirmProviderTransmission: false,
        },
        fetchImpl,
      ),
    ).rejects.toThrow('AI-enhanced analysis requires provider transmission confirmation.');
    expect(calls).toEqual([]);
  });

  it('returns content-free errors for failed analyze requests', async () => {
    const { fetchImpl } = fetchStub(jsonResponse({ error: 'PRIVATE CONTENT' }, { status: 400 }));

    await expect(
      analyzeLocal({ resumeText: '   ', jobText: 'Required: TypeScript' }, fetchImpl),
    ).rejects.toThrow('Analysis request failed. Check the supplied text.');
  });

  it('reads progress events and the final analysis from a streaming analyze request', async () => {
    const events = [
      JSON.stringify({
        kind: 'progress',
        stage: 'baseline-analysis',
        completed: 1,
        total: 4,
        message: 'Baseline complete.',
      }),
      JSON.stringify({
        kind: 'result',
        response: {
          schemaVersion: '1.0',
          analysis: {
            schemaVersion: '1.0',
            id: 'analysis-client-stream',
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
        },
      }),
    ].join('\n');
    const { calls, fetchImpl } = fetchStub(
      new Response(`${events}\n`, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      }),
    );
    const seen: string[] = [];

    const result = await analyzeLocalStream(
      { resumeText: 'Fictional resume text', jobText: 'Fictional job text' },
      { onEvent: (event) => seen.push(event.kind) },
      fetchImpl,
    );

    expect(result.analysis.id).toBe('analysis-client-stream');
    expect(seen).toEqual(['progress', 'result']);
    expect(calls[0]?.[0]).toBe('/api/analyze/stream');
    expect(calls[0]?.[1]?.headers).toMatchObject({ accept: 'application/x-ndjson' });
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

const historyItem = {
  schemaVersion: '1.0',
  id: 'analysis-history-item',
  profileId: 'profile-local',
  resumeDocumentId: 'document-resume',
  jobId: 'job-backend',
  overallScore: 80,
  recommendation: 'apply',
  confidence: 0.8,
  hasHardBlocker: false,
  generatedAt: '2026-01-01T00:00:00.000Z',
};

const analysisEnvelope = {
  schemaVersion: '1.0',
  analysis: {
    schemaVersion: '1.0',
    id: 'analysis-history-item',
    overallScore: 80,
    recommendation: 'apply',
    confidence: 0.8,
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
};

describe('history client API', () => {
  it('lists history without a query', async () => {
    const { calls, fetchImpl } = fetchStub(
      jsonResponse({ schemaVersion: '1.0', history: [historyItem] }),
    );

    await expect(listHistory(fetchImpl)).resolves.toEqual({
      schemaVersion: '1.0',
      history: [historyItem],
    });
    expect(calls).toEqual([['/api/history', undefined]]);
  });

  it('lists history with an encoded search query', async () => {
    const { calls, fetchImpl } = fetchStub(jsonResponse({ schemaVersion: '1.0', history: [] }));

    await expect(listHistory('Node.js Engineer', fetchImpl)).resolves.toEqual({
      schemaVersion: '1.0',
      history: [],
    });
    expect(calls).toEqual([['/api/history?query=Node.js%20Engineer', undefined]]);
  });

  it('opens a history item detail and maps a missing item to a content-free error', async () => {
    const { calls, fetchImpl } = fetchStub(jsonResponse(analysisEnvelope));

    await expect(getHistoryItem('analysis-history-item', fetchImpl)).resolves.toEqual(
      analysisEnvelope,
    );
    expect(calls).toEqual([['/api/history/analysis-history-item', undefined]]);

    const { fetchImpl: missingFetch } = fetchStub(
      jsonResponse({ error: 'Not found.' }, { status: 404 }),
    );
    await expect(getHistoryItem('analysis-history-item', missingFetch)).rejects.toThrow(
      'History item was not found. It may have been removed.',
    );
  });

  it('deletes a history item and rejects unknown ids', async () => {
    const { calls, fetchImpl } = fetchStub(jsonResponse({ removed: true }));

    await expect(deleteHistoryItem('analysis-history-item', fetchImpl)).resolves.toEqual({
      removed: true,
    });
    expect(calls).toEqual([
      ['/api/history/analysis-history-item', expect.objectContaining({ method: 'DELETE' })],
    ]);

    const { fetchImpl: missingFetch } = fetchStub(
      jsonResponse({ error: 'Not found.' }, { status: 404 }),
    );
    await expect(deleteHistoryItem('analysis-history-item', missingFetch)).rejects.toThrow(
      'History item was not found. It may have been removed.',
    );
  });

  it('returns content-free errors for unavailable history', async () => {
    const { fetchImpl } = fetchStub(
      jsonResponse({ error: 'History is unavailable.' }, { status: 503 }),
    );

    await expect(listHistory(fetchImpl)).rejects.toThrow(
      'History is unavailable. Local storage is not configured.',
    );
    await expect(getHistoryItem('analysis-history-item', fetchImpl)).rejects.toThrow(
      'History is unavailable. Local storage is not configured.',
    );
  });
});

describe('settings client API', () => {
  it('fetches current settings', async () => {
    const { calls, fetchImpl } = fetchStub(
      jsonResponse({ schemaVersion: '1.0', settings: {}, databasePath: 'local' }),
    );

    await expect(getSettings(fetchImpl)).resolves.toEqual({
      schemaVersion: '1.0',
      settings: {},
      databasePath: 'local',
    });
    expect(calls).toEqual([['/api/settings', undefined]]);
  });

  it('updates settings and validates the response', async () => {
    const { calls, fetchImpl } = fetchStub(
      jsonResponse({
        schemaVersion: '1.0',
        settings: { provider: 'openai', model: 'fictional-model' },
        databasePath: 'local',
      }),
    );

    await expect(
      updateSettings({ provider: 'openai', model: 'fictional-model' }, fetchImpl),
    ).resolves.toEqual({
      schemaVersion: '1.0',
      settings: { provider: 'openai', model: 'fictional-model' },
      databasePath: 'local',
    });
    const [url, init] = calls[0]!;
    expect(url).toBe('/api/settings');
    expect(init).toMatchObject({ method: 'PUT', headers: { 'content-type': 'application/json' } });
    expect(JSON.parse(init?.body as string)).toEqual({
      provider: 'openai',
      model: 'fictional-model',
    });
  });

  it('sends provider-only partial settings updates for server-side merge validation', async () => {
    const { calls, fetchImpl } = fetchStub(
      jsonResponse({
        schemaVersion: '1.0',
        settings: {
          provider: 'openai-compatible',
          model: 'fictional-model',
          baseUrl: 'http://localhost:11434/v1',
        },
        databasePath: 'local',
      }),
    );

    await expect(updateSettings({ provider: 'openai-compatible' }, fetchImpl)).resolves.toEqual({
      schemaVersion: '1.0',
      settings: {
        provider: 'openai-compatible',
        model: 'fictional-model',
        baseUrl: 'http://localhost:11434/v1',
      },
      databasePath: 'local',
    });
    const [, init] = calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({ provider: 'openai-compatible' });
  });

  it('clears stored settings by sending explicit null values', async () => {
    const { calls, fetchImpl } = fetchStub(
      jsonResponse({ schemaVersion: '1.0', settings: {}, databasePath: 'local' }),
    );

    await expect(
      updateSettings(
        {
          provider: null,
          model: null,
          defaultExportFormat: null,
          maxTotalTokens: null,
          maxCostUsd: null,
          providerTimeoutMs: null,
        },
        fetchImpl,
      ),
    ).resolves.toEqual({
      schemaVersion: '1.0',
      settings: {},
      databasePath: 'local',
    });
    const [url, init] = calls[0]!;
    expect(url).toBe('/api/settings');
    expect(JSON.parse(init?.body as string)).toEqual({
      provider: null,
      model: null,
      defaultExportFormat: null,
      maxTotalTokens: null,
      maxCostUsd: null,
      providerTimeoutMs: null,
    });
  });

  it('rejects invalid settings before making a request', async () => {
    const { calls, fetchImpl } = fetchStub(jsonResponse({ error: 'not used' }));

    await expect(updateSettings({ maxTotalTokens: 0 }, fetchImpl)).rejects.toThrow(
      'Settings are invalid. Provide a model with a provider, or a base URL for compatible providers.',
    );
    expect(calls).toHaveLength(0);
  });

  it('returns content-free errors when settings cannot be saved', async () => {
    const { fetchImpl } = fetchStub(jsonResponse({ error: 'PRIVATE CONTENT' }, { status: 500 }));

    await expect(updateSettings({ defaultExportFormat: 'json' }, fetchImpl)).rejects.toThrow(
      'Settings could not be saved. Check the local server and try again.',
    );
  });

  it('fetches provider credential status without API keys', async () => {
    const { calls, fetchImpl } = fetchStub(
      jsonResponse({
        schemaVersion: '1.0',
        credentials: [
          { provider: 'openai', configured: true, source: 'key-store' },
          { provider: 'openai-compatible', configured: false, source: 'none' },
        ],
      }),
    );

    await expect(getProviderCredentialStatus(fetchImpl)).resolves.toEqual({
      schemaVersion: '1.0',
      credentials: [
        { provider: 'openai', configured: true, source: 'key-store' },
        { provider: 'openai-compatible', configured: false, source: 'none' },
      ],
    });
    expect(calls).toEqual([['/api/provider-credentials', undefined]]);
  });

  it('lists provider models through a query-only local request', async () => {
    const { calls, fetchImpl } = fetchStub(
      jsonResponse({
        schemaVersion: '1.0',
        models: [{ id: 'phi4-mini:latest', structuredOutputSupported: null }],
      }),
    );

    await expect(
      listProviderModels(
        {
          provider: 'openai-compatible',
          destination: 'local',
          baseUrl: 'http://localhost:11434/v1',
        },
        fetchImpl,
      ),
    ).resolves.toMatchObject({ models: [{ id: 'phi4-mini:latest' }] });
    expect(calls[0]?.[0]).toBe(
      '/api/provider-models?provider=openai-compatible&destination=local&baseUrl=http%3A%2F%2Flocalhost%3A11434%2Fv1',
    );
    expect(calls[0]?.[1]).toBeUndefined();
  });

  it('saves and deletes provider credentials without parsing echoed secrets', async () => {
    const { calls, fetchImpl } = fetchStub(
      jsonResponse({
        schemaVersion: '1.0',
        credentials: [
          { provider: 'openai', configured: true, source: 'key-store' },
          { provider: 'openai-compatible', configured: false, source: 'none' },
        ],
      }),
    );

    await saveProviderCredential({ provider: 'openai', apiKey: 'fictional-secret' }, fetchImpl);
    const [saveUrl, saveInit] = calls[0]!;
    expect(saveUrl).toBe('/api/provider-credentials');
    expect(saveInit).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
    });
    expect(JSON.parse(saveInit?.body as string)).toEqual({
      provider: 'openai',
      apiKey: 'fictional-secret',
    });

    const { calls: deleteCalls, fetchImpl: deleteFetch } = fetchStub(
      jsonResponse({ removed: true }),
    );
    await expect(deleteProviderCredential('openai', deleteFetch)).resolves.toEqual({
      removed: true,
    });
    expect(deleteCalls).toEqual([
      ['/api/provider-credentials/openai', expect.objectContaining({ method: 'DELETE' })],
    ]);
  });

  it('rejects invalid credential saves before making a request', async () => {
    const { calls, fetchImpl } = fetchStub(jsonResponse({ error: 'not used' }));

    await expect(
      saveProviderCredential({ provider: 'openai', apiKey: '   ' }, fetchImpl),
    ).rejects.toThrow('Provider credential is invalid. Enter a non-empty API key.');
    expect(calls).toEqual([]);
  });
});

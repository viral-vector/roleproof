import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeStorage, createRoleProofRepositories, openStorage } from '@roleproof/storage';
import {
  CommandEnvelopeSchema,
  EnhancedAnalysisEnvelopeSchema,
  type AnalysisResult,
} from '@roleproof/shared';

import { runCli } from '../src/program.js';

const resume = 'Skills: TypeScript\nBuilt TypeScript services for a fictional employer.';
const job = 'Required Qualifications\n- TypeScript experience';

interface CompatibleBody {
  choices: Array<{ message: { content: string } }>;
}

interface RequirementResponseBody {
  requirements: Array<{ evidenceIds: string[] }>;
}

function compatibleResponse(input: Record<string, unknown>, operation: string): Response {
  const requirements = input.requirements as Array<{
    requirementId: string;
    baselineClassification: string;
    evidenceIds: string[];
  }>;
  const result = requirements.map((item) => ({
    requirementId: item.requirementId,
    baselineClassification: item.baselineClassification,
    classification: item.baselineClassification,
    evidenceIds: item.evidenceIds,
    explanation: 'The interpretation preserves the deterministic baseline.',
  }));
  const output =
    operation === 'analyze-requirements'
      ? { requirements: result }
      : operation === 'map-evidence'
        ? { mappings: result }
        : {
            suggestedEmphasis: [],
            suggestedAdditions: [],
            interviewTopics: [],
            coverLetterAngles: [],
          };
  return new Response(
    JSON.stringify({
      id: 'response-1',
      object: 'chat.completion',
      created: 1,
      model: 'local-model',
      choices: [
        { finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'request-1' } },
  );
}

async function openAIResponse(
  input: Record<string, unknown>,
  operation: string,
): Promise<Response> {
  const body = (await compatibleResponse(input, operation).json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: body.choices[0]!.message.content }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }),
    { status: 200, headers: { 'x-request-id': 'request-1' } },
  );
}

function operationAndInput(init?: RequestInit): {
  input: Record<string, unknown>;
  operation: string;
} {
  if (typeof init?.body !== 'string') throw new Error('Expected a serialized provider request');
  const body = JSON.parse(init.body) as {
    response_format?: { json_schema?: { name?: string } };
    text?: { format?: { name?: string } };
    messages?: Array<{ content: string }>;
    input?: Array<{ content: Array<{ text: string }> }>;
  };
  const operation =
    body.response_format?.json_schema?.name?.replaceAll('_', '-') ??
    body.text?.format?.name?.replaceAll('_', '-') ??
    findOperation(body.messages);
  const raw = body.messages?.at(-1)?.content ?? body.input?.[1]?.content[0]?.text ?? '';
  return { input: JSON.parse(raw) as Record<string, unknown>, operation };
}

function findOperation(
  messages: Array<{ content: string | Array<{ text: string }> }> | undefined,
): string {
  if (!Array.isArray(messages)) return '';
  for (const message of messages) {
    const content =
      typeof message?.content === 'string' ? message.content : message.content?.[0]?.text;
    if (typeof content !== 'string') continue;
    const match = /\bReturn only a valid JSON object for ([a-z-]+)\./u.exec(content);
    if (match !== null) return match[1]!;
  }
  return '';
}

async function invoke(args: string[]) {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli(args, {
    writeOut(value) {
      stdout += value;
    },
    writeErr(value) {
      stderr += value;
    },
  });
  return { exitCode, stderr, stdout };
}

describe('Phase 3 provider CLI integration', () => {
  let directory: string;
  let resumePath: string;
  let jobPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'roleproof provider cli path with spaces-'));
    resumePath = join(directory, 'fictional resume.txt');
    jobPath = join(directory, 'fictional job.txt');
    await Promise.all([writeFile(resumePath, resume), writeFile(jobPath, job)]);
    vi.unstubAllGlobals();
    vi.stubEnv('OPENAI_API_KEY', 'test-secret-key');
    vi.stubEnv('ROLEPROOF_PROVIDER_API_KEY', 'compatible-test-secret');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  const base = () => [
    'analyze',
    '--resume',
    resumePath,
    '--job',
    jobPath,
    '--no-store',
    '--format',
    'json',
    '--stdout',
  ];

  it('keeps omitted provider deterministic and never selects one from environment', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const omitted = await invoke(base());
    const explicit = await invoke([...base(), '--no-ai']);

    expect(omitted).toMatchObject({ exitCode: 0, stderr: '' });
    const omittedJson = JSON.parse(omitted.stdout) as { analysis: AnalysisResult };
    const explicitJson = JSON.parse(explicit.stdout) as { analysis: AnalysisResult };
    expect({ ...omittedJson.analysis, generatedAt: 'ignored' }).toEqual({
      ...explicitJson.analysis,
      generatedAt: 'ignored',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['provider without model', ['--provider', 'openai']],
    ['model without provider', ['--model', 'model-a']],
    ['no-ai provider conflict', ['--no-ai', '--provider', 'openai', '--model', 'model-a']],
    [
      'OpenAI base URL',
      ['--provider', 'openai', '--model', 'model-a', '--base-url', 'https://example.test/v1'],
    ],
    ['OpenAI non-hosted', ['--provider', 'openai', '--model', 'model-a', '--destination', 'local']],
    [
      'OpenAI json-object',
      ['--provider', 'openai', '--model', 'model-a', '--structured-output-mode', 'json-object'],
    ],
    [
      'compatible missing URL',
      ['--provider', 'openai-compatible', '--model', 'model-a', '--destination', 'local'],
    ],
    [
      'compatible remote URL labeled local',
      [
        '--provider',
        'openai-compatible',
        '--model',
        'model-a',
        '--destination',
        'local',
        '--base-url',
        'https://remote.example.test/v1',
      ],
    ],
    ['cost missing rates', ['--provider', 'openai', '--model', 'model-a', '--max-cost-usd', '1']],
  ])('rejects %s before fetch', async (_name, extra) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await invoke([...base(), ...extra]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires hosted confirmation before parsing or fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await invoke([...base(), '--provider', 'openai', '--model', 'model-a']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--confirm-transmission');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid provider configuration before reading inputs or creating storage', async () => {
    const databasePath = join(directory, 'must not be created.db');
    const result = await invoke([
      '--db',
      databasePath,
      'analyze',
      '--resume',
      join(directory, 'missing resume.txt'),
      '--job',
      jobPath,
      '--provider',
      'openai-compatible',
      '--model',
      'local-model',
      '--destination',
      'local',
      '--base-url',
      'https://remote.example.test/v1',
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('loopback');
    await expect(access(databasePath)).rejects.toThrow();
  });

  it.each(['openai', 'openai-compatible'])(
    'renders pure enhanced JSON after three valid %s calls',
    async (provider) => {
      if (provider === 'openai-compatible') vi.stubEnv('ROLEPROOF_PROVIDER_API_KEY', '');
      const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const { input, operation } = operationAndInput(init);
        return provider === 'openai'
          ? await openAIResponse(input, operation)
          : compatibleResponse(input, operation);
      });
      vi.stubGlobal('fetch', fetchMock);
      const extra =
        provider === 'openai'
          ? ['--provider', provider, '--model', 'model-a', '--confirm-transmission']
          : [
              '--provider',
              provider,
              '--model',
              'local-model',
              '--destination',
              'local',
              '--base-url',
              'http://127.0.0.1:11434/v1',
            ];
      const result = await invoke([
        ...base(),
        ...extra,
        '--redact-employer',
        '--redact-term',
        'fictional',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain(`Provider: ${provider}`);
      expect(result.stderr).not.toContain('test-secret-key');
      expect(result.stdout).not.toContain('fictional');
      const enhanced = EnhancedAnalysisEnvelopeSchema.parse(JSON.parse(result.stdout));
      expect(enhanced.aiEnhancement.providerExecutions).toHaveLength(3);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(enhanced.analysis.metadata.mode).toBe('deterministic');
    },
  );

  it('preserves baseline score, recommendation, blockers, and matches on success', async () => {
    await writeFile(jobPath, `${job}\nSalary: USD 80000-100000 annually`, 'utf8');
    const baselineResult = await invoke([...base(), '--target-salary-min', '120000']);
    const baseline = (JSON.parse(baselineResult.stdout) as { analysis: AnalysisResult }).analysis;
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const { input, operation } = operationAndInput(init);
      return Promise.resolve(compatibleResponse(input, operation));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await invoke([
      ...base(),
      '--target-salary-min',
      '120000',
      '--provider',
      'openai-compatible',
      '--model',
      'local-model',
      '--destination',
      'local',
      '--base-url',
      'http://localhost:11434/v1',
      '--max-cost-usd',
      '1',
      '--input-cost-per-million-usd',
      '1',
      '--output-cost-per-million-usd',
      '2',
    ]);
    const enhanced = EnhancedAnalysisEnvelopeSchema.parse(JSON.parse(result.stdout));
    expect(result.exitCode).toBe(10);
    expect(enhanced.analysis).toMatchObject({
      overallScore: baseline.overallScore,
      recommendation: baseline.recommendation,
      hardBlockers: baseline.hardBlockers,
      matchedRequirements: baseline.matchedRequirements,
    });
    expect(enhanced.aiEnhancement.providerExecutions[0]?.usage.costMicroUsd).toBe(20);
  });

  it.each([
    ['malformed output', () => new Response('{}', { status: 200 })],
    ['auth', () => new Response('{}', { status: 401 })],
    ['rate limit', () => new Response('{}', { status: 429 })],
    ['server failure', () => new Response('{}', { status: 503 })],
  ])('falls back safely on %s', async (_name, response) => {
    vi.stubGlobal('fetch', vi.fn(response));
    const result = await invoke([
      ...base(),
      '--provider',
      'openai-compatible',
      '--model',
      'local-model',
      '--destination',
      'local',
      '--base-url',
      'http://localhost:11434/v1',
    ]);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('deterministic fallback');
    expect(result.stderr).not.toContain(resume);
    expect((JSON.parse(result.stdout) as { analysis: AnalysisResult }).analysis.metadata.mode).toBe(
      'deterministic',
    );
  });

  it('uses fallback exit 4 instead of blocker exit 10 on provider failure', async () => {
    await writeFile(jobPath, `${job}\nSalary: USD 80000-100000 annually`, 'utf8');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('{}', { status: 503 })),
    );
    const result = await invoke([
      ...base(),
      '--target-salary-min',
      '120000',
      '--provider',
      'openai-compatible',
      '--model',
      'local-model',
      '--destination',
      'local',
      '--base-url',
      'http://localhost:11434/v1',
    ]);
    expect(result.exitCode).toBe(4);
    expect(
      (JSON.parse(result.stdout) as { analysis: AnalysisResult }).analysis.hardBlockers,
    ).not.toEqual([]);
  });

  it('falls back on unknown evidence and timeout without leaking content', async () => {
    const unknownEvidence = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const { input, operation } = operationAndInput(init);
      const response = compatibleResponse(input, operation);
      return response.text().then((text) => {
        const body = JSON.parse(text) as CompatibleBody;
        const choice = body.choices[0];
        if (choice === undefined) throw new Error('Expected a provider choice');
        const content = JSON.parse(choice.message.content) as RequirementResponseBody;
        const requirement = content.requirements[0];
        if (requirement === undefined) throw new Error('Expected a requirement response');
        requirement.evidenceIds = ['evidence-not-supplied'];
        choice.message.content = JSON.stringify(content);
        return new Response(JSON.stringify(body), { status: 200 });
      });
    });
    vi.stubGlobal('fetch', unknownEvidence);
    const args = [
      ...base(),
      '--provider',
      'openai-compatible',
      '--model',
      'local-model',
      '--destination',
      'local',
      '--base-url',
      'http://localhost:11434/v1',
    ];
    expect((await invoke(args)).exitCode).toBe(4);

    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const timeout = await invoke([...args, '--provider-timeout-ms', '1']);
    expect(timeout.exitCode).toBe(4);
    expect(timeout.stderr).not.toContain(resume);
  });

  it('does not open storage for stateless provider analysis', async () => {
    const databasePath = join(directory, 'must not exist', 'roleproof.db');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('{}', { status: 503 })),
    );
    const result = await invoke([
      '--db',
      databasePath,
      ...base(),
      '--provider',
      'openai-compatible',
      '--model',
      'local-model',
      '--destination',
      'local',
      '--base-url',
      'http://localhost:11434/v1',
    ]);
    expect(result.exitCode).toBe(4);
    await expect(access(join(directory, 'must not exist'))).rejects.toThrow();
  });

  it('persists and reuses a matching enhancement and rejects a mismatched rerun without fetch', async () => {
    const databasePath = join(directory, 'provider sidecar.db');
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const { input, operation } = operationAndInput(init);
      return Promise.resolve(compatibleResponse(input, operation));
    });
    vi.stubGlobal('fetch', fetchMock);
    const args = [
      '--db',
      databasePath,
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--format',
      'json',
      '--stdout',
      '--provider',
      'openai-compatible',
      '--model',
      'local-model',
      '--destination',
      'local',
      '--base-url',
      'http://127.0.0.1:11434/v1/',
    ];
    const first = await invoke(args);
    const enhanced = EnhancedAnalysisEnvelopeSchema.parse(JSON.parse(first.stdout));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const database = await openStorage({ path: databasePath });
    try {
      const repositories = createRoleProofRepositories(database);
      expect(await repositories.aiEnhancements.get(enhanced.analysis.id)).toBeDefined();
      expect(await repositories.providerCalls.list(enhanced.analysis.id)).toHaveLength(3);
    } finally {
      await closeStorage(database);
    }

    fetchMock.mockClear();
    const reused = await invoke(args);
    expect(reused.exitCode).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    const mismatch = await invoke(
      args.map((value) => (value === 'local-model' ? 'other-model' : value)),
    );
    expect(mismatch.exitCode).toBe(5);
    expect(fetchMock).not.toHaveBeenCalled();
    const endpointMismatch = await invoke(
      args.map((value) =>
        value === 'http://127.0.0.1:11434/v1/' ? 'http://127.0.0.1:12345/v1' : value,
      ),
    );
    expect(endpointMismatch.exitCode).toBe(5);
    expect(fetchMock).not.toHaveBeenCalled();
    const modeMismatch = await invoke([...args, '--structured-output-mode', 'json-schema']);
    expect(modeMismatch.exitCode).toBe(5);
    expect(fetchMock).not.toHaveBeenCalled();

    const report = await invoke([
      '--db',
      databasePath,
      'report',
      'show',
      '--analysis',
      enhanced.analysis.id,
      '--format',
      'json',
    ]);
    const reportEnvelope = CommandEnvelopeSchema.parse(JSON.parse(report.stdout));
    expect(reportEnvelope).toMatchObject({
      schemaVersion: '2.0',
      command: 'report.show',
      data: { aiEnhancement: { baselineAnalysisId: enhanced.analysis.id } },
    });
  });

  it('requires provider credentials before parsing even when a stored enhancement exists', async () => {
    const databasePath = join(directory, 'offline provider reuse.db');
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const { input, operation } = operationAndInput(init);
      return await openAIResponse(input, operation);
    });
    vi.stubGlobal('fetch', fetchMock);
    const args = [
      '--db',
      databasePath,
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--format',
      'json',
      '--stdout',
      '--provider',
      'openai',
      '--model',
      'model-a',
      '--confirm-transmission',
    ];

    expect((await invoke(args)).exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockClear();
    vi.stubEnv('OPENAI_API_KEY', '');
    const reused = await invoke(args);
    expect(reused.exitCode).toBe(2);
    expect(reused.stdout).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects missing hosted credentials before reading inputs or creating storage', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const databasePath = join(directory, 'missing credential.db');
    const result = await invoke([
      '--db',
      databasePath,
      'analyze',
      '--resume',
      join(directory, 'missing resume.txt'),
      '--job',
      jobPath,
      '--provider',
      'openai',
      '--model',
      'model-a',
      '--confirm-transmission',
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('OPENAI_API_KEY');
    await expect(access(databasePath)).rejects.toThrow();
  });

  it('stores only sanitized provider failure metadata when persistence is enabled', async () => {
    const databasePath = join(directory, 'provider failure.db');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('private raw response', { status: 503 })),
    );
    const result = await invoke([
      '--db',
      databasePath,
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--format',
      'json',
      '--stdout',
      '--provider',
      'openai-compatible',
      '--model',
      'local-model',
      '--destination',
      'local',
      '--base-url',
      'http://localhost:11434/v1',
      '--redact-term',
      'TypeScript',
    ]);
    expect(result.exitCode).toBe(4);
    const baseline = JSON.parse(result.stdout) as { analysis: AnalysisResult };
    const database = await openStorage({ path: databasePath });
    try {
      const calls = await createRoleProofRepositories(database).providerCalls.list(
        baseline.analysis.id,
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        status: 'failed',
        errorCode: 'unavailable',
        redactionApplied: true,
        redactionCategories: ['user-selected-term'],
      });
      expect(JSON.stringify(calls)).not.toContain('private raw response');
      expect(JSON.stringify(calls)).not.toContain(resume);
    } finally {
      await closeStorage(database);
    }
  });

  it('audits completed usage before a later operation fails', async () => {
    const databasePath = join(directory, 'partial provider failure.db');
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 3)
        return Promise.resolve(new Response('{}', { status: 503 }));
      const { input, operation } = operationAndInput(init);
      return Promise.resolve(compatibleResponse(input, operation));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await invoke([
      '--db',
      databasePath,
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--format',
      'json',
      '--stdout',
      '--provider',
      'openai-compatible',
      '--model',
      'local-model',
      '--destination',
      'local',
      '--base-url',
      'http://localhost:11434/v1',
    ]);
    const baseline = JSON.parse(result.stdout) as { analysis: AnalysisResult };
    const database = await openStorage({ path: databasePath });
    try {
      const calls = await createRoleProofRepositories(database).providerCalls.list(
        baseline.analysis.id,
      );
      expect(calls.filter(({ status }) => status === 'succeeded')).toHaveLength(2);
      expect(calls.filter(({ status }) => status === 'failed')).toHaveLength(1);
      expect(
        calls.filter(({ status }) => status === 'succeeded').map(({ totalTokens }) => totalTokens),
      ).toEqual([15, 15]);
    } finally {
      await closeStorage(database);
    }
  });

  it('returns deterministic fallback on repeated identical stored provider failures', async () => {
    const databasePath = join(directory, 'repeated provider failure.db');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('{}', { status: 503 })),
    );
    const args = [
      '--db',
      databasePath,
      'analyze',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--format',
      'json',
      '--stdout',
      '--provider',
      'openai-compatible',
      '--model',
      'local-model',
      '--destination',
      'local',
      '--base-url',
      'http://localhost:11434/v1',
    ];

    for (const result of [await invoke(args), await invoke(args)]) {
      expect(result.exitCode).toBe(4);
      const parsed: unknown = JSON.parse(result.stdout);
      expect(parsed).toBeTypeOf('object');
      expect(result.stderr).toContain('deterministic fallback');
    }
  });

  it('lists static providers and tests health without career payload or confirmation', async () => {
    const listed = await invoke(['providers', 'list', '--format', 'json']);
    expect(CommandEnvelopeSchema.parse(JSON.parse(listed.stdout))).toMatchObject({
      command: 'providers.list',
      data: { providers: [{ provider: 'openai' }, { provider: 'openai-compatible' }] },
    });
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), { status: 200 }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const tested = await invoke([
      'providers',
      'test',
      '--provider',
      'openai-compatible',
      '--model',
      'local-model',
      '--destination',
      'local',
      '--base-url',
      'http://localhost:11434/v1',
      '--format',
      'json',
    ]);
    expect(tested.exitCode).toBe(0);
    expect(CommandEnvelopeSchema.parse(JSON.parse(tested.stdout))).toMatchObject({
      command: 'providers.test',
      data: { health: { status: 'healthy' } },
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'z-model' }, { id: 'a-model' }] }), {
        status: 200,
      }),
    );
    const models = await invoke([
      'providers',
      'models',
      '--provider',
      'openai-compatible',
      '--destination',
      'local',
      '--base-url',
      'http://localhost:11434/v1',
      '--format',
      'json',
    ]);
    expect(models.exitCode).toBe(0);
    expect(CommandEnvelopeSchema.parse(JSON.parse(models.stdout))).toMatchObject({
      command: 'providers.models',
      data: { models: [{ id: 'a-model' }, { id: 'z-model' }] },
    });
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBeUndefined();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'other-model' }] }), { status: 200 }),
    );
    const degraded = await invoke([
      'providers',
      'test',
      '--provider',
      'openai-compatible',
      '--model',
      'local-model',
      '--destination',
      'local',
      '--base-url',
      'http://localhost:11434/v1',
    ]);
    expect(degraded.exitCode).toBe(4);
    expect(degraded.stdout).not.toContain(resume);
  });
});

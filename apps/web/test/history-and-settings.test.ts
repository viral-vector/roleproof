import { describe, expect, it } from 'vitest';
import {
  LocalAnalyzeResponseSchema,
  LocalHistoryListResponseSchema,
  LocalProviderModelsResponseSchema,
  LocalSettingsResponseSchema,
  LocalSettingsSchema,
  type ApplicationSuggestionInput,
  type ApplicationSuggestionOutput,
  type EvidenceMappingInput,
  type EvidenceMappingOutput,
  type LocalHistoryItem,
  type ProviderConfig,
  type ProviderExecutionMetadata,
  type ProviderHealth,
  type RequirementAnalysisInput,
  type RequirementAnalysisOutput,
} from '@roleproof/shared';
import {
  ProviderError,
  type AIProvider,
  type ProviderCallContext,
  type ProviderResult,
} from '@roleproof/providers';
import {
  closeStorage,
  createRoleProofRepositories,
  openStorage,
  StorageError,
  type RoleProofRepositories,
  type StorageDatabase,
} from '@roleproof/storage';

import { createLocalWebApp, type ProviderCredentialStore } from '../src/server.js';

const resumeText = [
  'Avery Morgan',
  'Location: Remote',
  'Work authorization: Authorized without sponsorship',
  'Skills: TypeScript, Node.js, PostgreSQL',
  '2020-2026: Built TypeScript REST APIs with Node.js and PostgreSQL.',
].join('\n');

const jobText = [
  'Fictional Backend Engineer',
  '',
  'Required Qualifications',
  '- TypeScript',
  '- Node.js',
  '- PostgreSQL',
].join('\n');

const otherJobText = [
  'Fictional Data Analyst',
  '',
  'Required Qualifications',
  '- SQL',
  '- Python',
  '- Tableau',
].join('\n');

function analyzePayload(resume: string, job: string) {
  return { schemaVersion: '1.0', mode: 'deterministic', resumeText: resume, jobText: job };
}

function aiAnalyzePayload(resume: string, job: string) {
  return {
    schemaVersion: '1.0',
    mode: 'ai-enhanced',
    resumeText: resume,
    jobText: job,
    confirmProviderTransmission: true,
  };
}

function executionMetadata(
  config: ProviderConfig,
  context: ProviderCallContext<unknown>,
  operation: ProviderExecutionMetadata['operation'],
): ProviderExecutionMetadata {
  return {
    operation,
    provider: config.provider,
    model: config.model,
    destination: config.destination,
    manifest: context.manifest,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costMicroUsd: null },
    requestId: `request:${operation.replaceAll('-', '_')}`,
    errorCode: null,
  };
}

function successfulProvider(config: ProviderConfig, calls: string[]): AIProvider {
  return {
    id: config.provider,
    config,
    endpointOrigin:
      config.baseUrl === null ? 'https://api.openai.com' : new URL(config.baseUrl).origin,
    analyzeRequirements(
      context: ProviderCallContext<RequirementAnalysisInput>,
    ): Promise<ProviderResult<RequirementAnalysisOutput>> {
      calls.push('analyze-requirements');
      return Promise.resolve({
        output: {
          requirements: context.input.requirements.map((requirement) => ({
            requirementId: requirement.requirementId,
            baselineClassification: requirement.baselineClassification,
            classification: requirement.baselineClassification,
            evidenceIds: requirement.evidenceIds,
            explanation: 'Fictional provider explanation.',
          })),
        },
        metadata: executionMetadata(config, context, 'analyze-requirements'),
      });
    },
    mapEvidence(
      context: ProviderCallContext<EvidenceMappingInput>,
    ): Promise<ProviderResult<EvidenceMappingOutput>> {
      calls.push('map-evidence');
      return Promise.resolve({
        output: {
          mappings: context.input.requirements.map((requirement) => ({
            requirementId: requirement.requirementId,
            baselineClassification: requirement.baselineClassification,
            classification: requirement.baselineClassification,
            evidenceIds: requirement.evidenceIds,
            explanation: 'Fictional evidence mapping.',
          })),
        },
        metadata: executionMetadata(config, context, 'map-evidence'),
      });
    },
    suggestApplicationChanges(
      context: ProviderCallContext<ApplicationSuggestionInput>,
    ): Promise<ProviderResult<ApplicationSuggestionOutput>> {
      calls.push('suggest-application-changes');
      return Promise.resolve({
        output: {
          suggestedEmphasis: [],
          suggestedAdditions: [],
          interviewTopics: [],
          coverLetterAngles: [],
        },
        metadata: executionMetadata(config, context, 'suggest-application-changes'),
      });
    },
    healthCheck(): Promise<ProviderResult<ProviderHealth>> {
      return Promise.reject(new ProviderError('configuration', 'health-check'));
    },
    listModels(): Promise<ProviderResult<{ models: readonly [] }>> {
      return Promise.reject(new ProviderError('configuration', 'health-check'));
    },
  };
}

async function appWithStorage() {
  const database: StorageDatabase = await openStorage({ path: ':memory:' });
  const repositories: RoleProofRepositories = createRoleProofRepositories(database);
  const app = createLocalWebApp({ repositories, databasePath: ':memory:' });
  return { app, database, repositories };
}

async function appWithAIProvider(providerFactory: (config: ProviderConfig) => AIProvider) {
  const database: StorageDatabase = await openStorage({ path: ':memory:' });
  const repositories: RoleProofRepositories = createRoleProofRepositories(database);
  const app = createLocalWebApp({
    repositories,
    databasePath: ':memory:',
    providerFactory,
  } as unknown as Parameters<typeof createLocalWebApp>[0]);
  return { app, database, repositories };
}

function memoryCredentialStore(seed: Partial<Record<'openai' | 'openai-compatible', string>> = {}) {
  const values = new Map(Object.entries(seed));
  const store: ProviderCredentialStore = {
    get(provider) {
      return Promise.resolve(values.get(provider) ?? null);
    },
    set(provider, apiKey) {
      values.set(provider, apiKey);
      return Promise.resolve();
    },
    delete(provider) {
      const removed = values.delete(provider);
      return Promise.resolve(removed);
    },
  };
  return { store, values };
}

async function configureLocalProvider(repositories: RoleProofRepositories) {
  await repositories.settings.update({
    provider: 'openai-compatible',
    model: 'fictional-model',
    destination: 'local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    structuredOutputMode: 'json-object',
  });
}

async function closeApp(app: ReturnType<typeof createLocalWebApp>, database?: StorageDatabase) {
  await app.close();
  if (database !== undefined) await closeStorage(database);
}

describe('local history API', () => {
  it('persists deterministic analyses so history lists each id once', async () => {
    const { app, database } = await appWithStorage();

    try {
      const first = await app.inject({
        method: 'POST',
        url: '/api/analyze',
        payload: analyzePayload(resumeText, jobText),
      });
      const second = await app.inject({
        method: 'POST',
        url: '/api/analyze',
        payload: analyzePayload(resumeText, jobText),
      });
      const history = await app.inject({ method: 'GET', url: '/api/history' });
      const body = LocalHistoryListResponseSchema.parse(JSON.parse(history.body));

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body)).toEqual(JSON.parse(first.body));
      expect(history.statusCode).toBe(200);
      expect(body.history).toHaveLength(1);
      expect(body.history[0]).toMatchObject({
        id: (JSON.parse(first.body) as { analysis: { id: string } }).analysis.id,
        recommendation: 'apply',
      });
    } finally {
      await closeApp(app, database);
    }
  });

  it('searches history by job text and by recommendation', async () => {
    const { app, database } = await appWithStorage();

    try {
      await app.inject({
        method: 'POST',
        url: '/api/analyze',
        payload: analyzePayload(resumeText, jobText),
      });
      await app.inject({
        method: 'POST',
        url: '/api/analyze',
        payload: analyzePayload(resumeText, otherJobText),
      });

      const bySkill = await app.inject({ method: 'GET', url: '/api/history?query=tableau' });
      const skillBody = LocalHistoryListResponseSchema.parse(JSON.parse(bySkill.body));
      expect(skillBody.history).toHaveLength(1);
      expect(skillBody.history[0]?.jobId).toBeDefined();

      const byRecommendation = await app.inject({ method: 'GET', url: '/api/history?query=apply' });
      const recommendationBody = LocalHistoryListResponseSchema.parse(
        JSON.parse(byRecommendation.body),
      );
      expect(recommendationBody.history.length).toBeGreaterThan(0);
      for (const item of recommendationBody.history) {
        expect(item.recommendation).toBe('apply');
      }

      const byCompany = await app.inject({ method: 'GET', url: '/api/history?query=fictional' });
      const companyBody = LocalHistoryListResponseSchema.parse(JSON.parse(byCompany.body));
      expect(companyBody.history.map((item: LocalHistoryItem) => item.jobId)).toEqual(
        expect.arrayContaining(companyBody.history.map((item: LocalHistoryItem) => item.jobId)),
      );
      expect(companyBody.history.length).toBeGreaterThanOrEqual(2);
    } finally {
      await closeApp(app, database);
    }
  });

  it('opens a stored report detail and 404s for missing ids', async () => {
    const { app, database } = await appWithStorage();

    try {
      const analyzed = await app.inject({
        method: 'POST',
        url: '/api/analyze',
        payload: analyzePayload(resumeText, jobText),
      });
      const analysisId = (JSON.parse(analyzed.body) as { analysis: { id: string } }).analysis.id;

      const detail = await app.inject({ method: 'GET', url: `/api/history/${analysisId}` });
      const missing = await app.inject({ method: 'GET', url: '/api/history/analysis-missing' });

      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.body)).toEqual(JSON.parse(analyzed.body));
      expect(missing.statusCode).toBe(404);
    } finally {
      await closeApp(app, database);
    }
  });

  it('deletes a report with its orphaned job and 404s for unknown ids', async () => {
    const { app, database } = await appWithStorage();

    try {
      await app.inject({
        method: 'POST',
        url: '/api/analyze',
        payload: analyzePayload(resumeText, otherJobText),
      });
      const history = await app.inject({ method: 'GET', url: '/api/history' });
      const id = LocalHistoryListResponseSchema.parse(JSON.parse(history.body)).history[0]!.id;

      const removed = await app.inject({ method: 'DELETE', url: `/api/history/${id}` });
      const afterDelete = await app.inject({ method: 'GET', url: '/api/history' });
      const unknown = await app.inject({ method: 'DELETE', url: '/api/history/analysis-missing' });

      expect(removed.statusCode).toBe(200);
      expect(JSON.parse(removed.body)).toEqual({ removed: true });
      expect(LocalHistoryListResponseSchema.parse(JSON.parse(afterDelete.body)).history).toEqual(
        [],
      );
      expect(unknown.statusCode).toBe(404);
    } finally {
      await closeApp(app, database);
    }
  });

  it('returns 503 for history routes when storage is not configured', async () => {
    const app = createLocalWebApp();

    try {
      const list = await app.inject({ method: 'GET', url: '/api/history' });
      const detail = await app.inject({ method: 'GET', url: '/api/history/analysis-1' });
      const deleted = await app.inject({ method: 'DELETE', url: '/api/history/analysis-1' });

      expect(list.statusCode).toBe(503);
      expect(detail.statusCode).toBe(503);
      expect(deleted.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  it('returns the stored analysis when a racing save collides', async () => {
    const database = await openStorage({ path: ':memory:' });
    const repositories = createRoleProofRepositories(database);
    const app = createLocalWebApp({ repositories, databasePath: ':memory:' });

    try {
      const payload = analyzePayload(resumeText, jobText);
      const first = await app.inject({ method: 'POST', url: '/api/analyze', payload });
      const firstAnalysis = LocalAnalyzeResponseSchema.parse(JSON.parse(first.body)).analysis;

      const realGet = repositories.analyses.get.bind(repositories.analyses);
      let getCalls = 0;
      const racing = createLocalWebApp({
        repositories: {
          ...repositories,
          analyses: {
            ...repositories.analyses,
            async get(id: string) {
              getCalls += 1;
              return getCalls === 1 ? undefined : realGet(id);
            },
            save(): Promise<never> {
              return Promise.reject(new StorageError('REPOSITORY_FAILED', 'save analysis'));
            },
          },
        },
        databasePath: ':memory:',
      });

      const second = await racing.inject({ method: 'POST', url: '/api/analyze', payload });
      const secondAnalysis = LocalAnalyzeResponseSchema.parse(JSON.parse(second.body)).analysis;

      expect(second.statusCode).toBe(200);
      expect(secondAnalysis.id).toBe(firstAnalysis.id);
    } finally {
      await app.close();
      await closeStorage(database);
    }
  });
});

describe('local AI analyze API', () => {
  it('never calls a configured provider for deterministic analysis', async () => {
    const calls: string[] = [];
    const { app, database, repositories } = await appWithAIProvider((config) =>
      successfulProvider(config, calls),
    );

    try {
      await configureLocalProvider(repositories);
      const response = await app.inject({
        method: 'POST',
        url: '/api/analyze',
        payload: analyzePayload(resumeText, jobText),
      });
      const body = LocalAnalyzeResponseSchema.parse(JSON.parse(response.body));

      expect(response.statusCode).toBe(200);
      expect(body.schemaVersion).toBe('1.0');
      expect(calls).toEqual([]);
    } finally {
      await closeApp(app, database);
    }
  });

  it('rejects AI-enhanced analysis when provider settings are missing', async () => {
    const calls: string[] = [];
    const { app, database } = await appWithAIProvider((config) =>
      successfulProvider(config, calls),
    );

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/analyze',
        payload: aiAnalyzePayload(resumeText, jobText),
      });

      expect(response.statusCode).toBe(400);
      expect(calls).toEqual([]);
    } finally {
      await closeApp(app, database);
    }
  });

  it('returns and persists an enhanced envelope from a mocked provider', async () => {
    const calls: string[] = [];
    const { app, database, repositories } = await appWithAIProvider((config) =>
      successfulProvider(config, calls),
    );

    try {
      await configureLocalProvider(repositories);
      const response = await app.inject({
        method: 'POST',
        url: '/api/analyze',
        payload: aiAnalyzePayload(resumeText, jobText),
      });
      const body = LocalAnalyzeResponseSchema.parse(JSON.parse(response.body));

      expect(response.statusCode).toBe(200);
      expect(body.schemaVersion).toBe('2.0');
      expect(calls).toEqual([
        'analyze-requirements',
        'map-evidence',
        'suggest-application-changes',
      ]);
      if (body.schemaVersion !== '2.0') throw new Error('Expected enhanced response');
      expect(body.aiEnhancement.baselineAnalysisId).toBe(body.analysis.id);
      await expect(repositories.aiEnhancements.get(body.analysis.id)).resolves.toBeDefined();
    } finally {
      await closeApp(app, database);
    }
  });

  it('falls back to the deterministic envelope and records a provider failure', async () => {
    const calls: string[] = [];
    const { app, database, repositories } = await appWithAIProvider((config) => ({
      ...successfulProvider(config, calls),
      analyzeRequirements() {
        calls.push('analyze-requirements');
        return Promise.reject(new ProviderError('timeout', 'analyze-requirements'));
      },
    }));

    try {
      await configureLocalProvider(repositories);
      const response = await app.inject({
        method: 'POST',
        url: '/api/analyze',
        payload: aiAnalyzePayload(resumeText, jobText),
      });
      const body = LocalAnalyzeResponseSchema.parse(JSON.parse(response.body));
      const callsStored = await repositories.providerCalls.list(body.analysis.id);

      expect(response.statusCode).toBe(200);
      expect(body.schemaVersion).toBe('1.0');
      expect(calls).toEqual(['analyze-requirements']);
      expect(callsStored).toHaveLength(1);
      expect(callsStored[0]?.status).toBe('failed');
      expect(callsStored[0]?.errorCode).toBe('timeout');
    } finally {
      await closeApp(app, database);
    }
  });
});

describe('local settings API', () => {
  it('returns empty settings with the resolved database path', async () => {
    const { app, database } = await appWithStorage();

    try {
      const response = await app.inject({ method: 'GET', url: '/api/settings' });
      const body = LocalSettingsResponseSchema.parse(JSON.parse(response.body));

      expect(response.statusCode).toBe(200);
      expect(body.settings).toEqual({
        provider: 'openai-compatible',
        model: 'phi4-mini:latest',
        destination: 'local',
        baseUrl: 'http://localhost:11434/v1',
        structuredOutputMode: 'json-schema',
      });
      expect(body.databasePath).toBe(':memory:');
    } finally {
      await closeApp(app, database);
    }
  });

  it('persists settings updates and reflects them on GET', async () => {
    const { app, database } = await appWithStorage();

    try {
      const update = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: {
          provider: 'openai',
          model: 'fictional-model',
          defaultExportFormat: 'markdown',
          redactEmployer: true,
          maxTotalTokens: 4096,
        },
      });
      const fetch = await app.inject({ method: 'GET', url: '/api/settings' });

      expect(update.statusCode).toBe(200);
      const updateBody = LocalSettingsResponseSchema.parse(JSON.parse(update.body));
      expect(updateBody.settings).toEqual({
        provider: 'openai',
        model: 'fictional-model',
        defaultExportFormat: 'markdown',
        redactEmployer: true,
        maxTotalTokens: 4096,
      });
      const fetchBody = LocalSettingsResponseSchema.parse(JSON.parse(fetch.body));
      expect(fetchBody.settings).toEqual(updateBody.settings);
    } finally {
      await closeApp(app, database);
    }
  });

  it('validates partial settings updates after merging with stored settings', async () => {
    const { app, database } = await appWithStorage();

    try {
      await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: {
          provider: 'openai',
          model: 'fictional-model',
          baseUrl: 'http://localhost:11434/v1',
        },
      });

      const update = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { provider: 'openai-compatible' },
      });

      expect(update.statusCode).toBe(200);
      const updateBody = LocalSettingsResponseSchema.parse(JSON.parse(update.body));
      expect(updateBody.settings).toEqual({
        provider: 'openai-compatible',
        model: 'fictional-model',
        baseUrl: 'http://localhost:11434/v1',
      });
    } finally {
      await closeApp(app, database);
    }
  });

  it('clears stored settings when an update sends explicit null values', async () => {
    const { app, database } = await appWithStorage();

    try {
      const seed = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: {
          provider: 'openai-compatible',
          model: 'fictional-model',
          destination: 'local',
          baseUrl: 'http://localhost:11434/v1',
          defaultExportFormat: 'markdown',
          maxTotalTokens: 4096,
          maxCostUsd: 0.5,
          inputMicroUsdPerMillionTokens: 100_000,
          outputMicroUsdPerMillionTokens: 200_000,
          providerTimeoutMs: 60_000,
          structuredOutputMode: 'json-object',
        },
      });
      expect(seed.statusCode).toBe(200);

      const cleared = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: {
          provider: null,
          model: null,
          baseUrl: null,
          defaultExportFormat: null,
          maxTotalTokens: null,
          maxCostUsd: null,
          inputMicroUsdPerMillionTokens: null,
          outputMicroUsdPerMillionTokens: null,
          providerTimeoutMs: null,
          structuredOutputMode: null,
        },
      });
      const fetch = await app.inject({ method: 'GET', url: '/api/settings' });

      expect(cleared.statusCode).toBe(200);
      const clearedBody = LocalSettingsResponseSchema.parse(JSON.parse(cleared.body));
      expect(clearedBody.settings).toEqual({
        provider: 'openai-compatible',
        model: 'phi4-mini:latest',
        destination: 'local',
        baseUrl: 'http://localhost:11434/v1',
        structuredOutputMode: 'json-schema',
      });
      const fetchBody = LocalSettingsResponseSchema.parse(JSON.parse(fetch.body));
      expect(fetchBody.settings).toEqual({
        provider: 'openai-compatible',
        model: 'phi4-mini:latest',
        destination: 'local',
        baseUrl: 'http://localhost:11434/v1',
        structuredOutputMode: 'json-schema',
      });
    } finally {
      await closeApp(app, database);
    }
  });

  it('rejects invalid settings updates without persisting them', async () => {
    const { app, database } = await appWithStorage();

    try {
      const invalid = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { provider: 'openai' },
      });
      const incompatible = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { provider: 'openai-compatible', model: 'fictional-model', baseUrl: null },
      });
      const fetch = await app.inject({ method: 'GET', url: '/api/settings' });

      expect(invalid.statusCode).toBe(400);
      expect(incompatible.statusCode).toBe(400);
      const fetchedSettings = LocalSettingsResponseSchema.parse(JSON.parse(fetch.body));
      expect(LocalSettingsSchema.safeParse(fetchedSettings.settings).success).toBe(true);
      expect(fetchedSettings.settings).toEqual({
        provider: 'openai-compatible',
        model: 'phi4-mini:latest',
        destination: 'local',
        baseUrl: 'http://localhost:11434/v1',
        structuredOutputMode: 'json-schema',
      });
    } finally {
      await closeApp(app, database);
    }
  });

  it('returns 503 for settings routes when storage is not configured', async () => {
    const app = createLocalWebApp();

    try {
      const fetched = await app.inject({ method: 'GET', url: '/api/settings' });
      const updated = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { defaultExportFormat: 'json' },
      });

      expect(fetched.statusCode).toBe(503);
      expect(updated.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  it('stores provider credentials in the injected key store without echoing secrets', async () => {
    const { store, values } = memoryCredentialStore();
    const app = createLocalWebApp({ credentialStore: store });

    try {
      const saved = await app.inject({
        method: 'PUT',
        url: '/api/provider-credentials',
        payload: { provider: 'openai', apiKey: 'fictional-secret' },
      });
      const status = await app.inject({ method: 'GET', url: '/api/provider-credentials' });

      expect(saved.statusCode).toBe(200);
      expect(saved.body).not.toContain('fictional-secret');
      expect(values.get('openai')).toBe('fictional-secret');
      expect(JSON.parse(status.body)).toEqual({
        schemaVersion: '1.0',
        credentials: [
          { provider: 'openai', configured: true, source: 'key-store' },
          { provider: 'openai-compatible', configured: false, source: 'none' },
        ],
      });
      const removed = await app.inject({
        method: 'DELETE',
        url: '/api/provider-credentials/openai',
      });
      expect(JSON.parse(removed.body)).toEqual({ removed: true });
      expect(values.has('openai')).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('reports environment credentials without persisting them to the key store', async () => {
    const { store, values } = memoryCredentialStore();
    const app = createLocalWebApp({
      credentialStore: store,
      credentialEnvironment: { OPENAI_API_KEY: 'fictional-env-secret' },
    });

    try {
      const status = await app.inject({ method: 'GET', url: '/api/provider-credentials' });

      expect(JSON.parse(status.body)).toEqual({
        schemaVersion: '1.0',
        credentials: [
          { provider: 'openai', configured: true, source: 'environment' },
          { provider: 'openai-compatible', configured: false, source: 'none' },
        ],
      });
      expect(values.size).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('rejects malformed credential requests with content-free errors', async () => {
    const { store, values } = memoryCredentialStore();
    const app = createLocalWebApp({ credentialStore: store });

    try {
      const invalidSave = await app.inject({
        method: 'PUT',
        url: '/api/provider-credentials',
        payload: { provider: 'unsupported', apiKey: 'fictional-secret' },
      });
      const invalidDelete = await app.inject({
        method: 'DELETE',
        url: '/api/provider-credentials/unsupported',
      });

      expect(invalidSave.statusCode).toBe(400);
      expect(invalidDelete.statusCode).toBe(400);
      expect(invalidSave.body).not.toContain('fictional-secret');
      expect(values.size).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('lists provider models from current local provider settings without career data', async () => {
    const calls: ProviderConfig[] = [];
    const { app, database, repositories } = await appWithAIProvider((config) => {
      calls.push(config);
      return {
        ...successfulProvider(config, []),
        listModels(): Promise<
          ProviderResult<{ models: readonly [{ id: 'zeta' }, { id: 'alpha' }] }>
        > {
          return Promise.resolve({
            output: { models: [{ id: 'zeta' }, { id: 'alpha' }] },
            metadata: {
              operation: 'health-check',
              provider: config.provider,
              model: config.model,
              destination: config.destination,
              manifest: {
                provider: config.provider,
                model: config.model,
                destination: config.destination,
                endpointOrigin: 'http://127.0.0.1:11434',
                dataCategories: [],
                redactionApplied: true,
                redactionSummary: {
                  categories: [],
                  replacementCount: 0,
                  inputChars: 0,
                  outputChars: 0,
                },
              },
              usage: {
                inputTokens: null,
                outputTokens: null,
                totalTokens: null,
                costMicroUsd: null,
              },
              requestId: 'models-request-1',
              errorCode: null,
            },
          });
        },
      };
    });
    try {
      await configureLocalProvider(repositories);
      const response = await app.inject({
        method: 'GET',
        url: '/api/provider-models?provider=openai-compatible&destination=local&baseUrl=http%3A%2F%2F127.0.0.1%3A11434%2Fv1',
      });
      const body = LocalProviderModelsResponseSchema.parse(JSON.parse(response.body));

      expect(response.statusCode).toBe(200);
      expect(body.models.map((model) => model.id)).toEqual(['zeta', 'alpha']);
      expect(calls[0]).toMatchObject({
        provider: 'openai-compatible',
        destination: 'local',
        baseUrl: 'http://127.0.0.1:11434/v1',
      });
    } finally {
      await closeApp(app, database);
    }
  });
});

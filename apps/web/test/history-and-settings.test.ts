import { describe, expect, it } from 'vitest';
import {
  LocalAnalyzeResponseSchema,
  LocalHistoryListResponseSchema,
  LocalSettingsResponseSchema,
  LocalSettingsSchema,
  type LocalHistoryItem,
} from '@roleproof/shared';
import {
  closeStorage,
  createRoleProofRepositories,
  openStorage,
  StorageError,
  type RoleProofRepositories,
  type StorageDatabase,
} from '@roleproof/storage';

import { createLocalWebApp } from '../src/server.js';

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

async function appWithStorage() {
  const database: StorageDatabase = await openStorage({ path: ':memory:' });
  const repositories: RoleProofRepositories = createRoleProofRepositories(database);
  const app = createLocalWebApp({ repositories, databasePath: ':memory:' });
  return { app, database, repositories };
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

describe('local settings API', () => {
  it('returns empty settings with the resolved database path', async () => {
    const { app, database } = await appWithStorage();

    try {
      const response = await app.inject({ method: 'GET', url: '/api/settings' });
      const body = LocalSettingsResponseSchema.parse(JSON.parse(response.body));

      expect(response.statusCode).toBe(200);
      expect(body.settings).toEqual({});
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
          providerTimeoutMs: 60_000,
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
          providerTimeoutMs: null,
        },
      });
      const fetch = await app.inject({ method: 'GET', url: '/api/settings' });

      expect(cleared.statusCode).toBe(200);
      const clearedBody = LocalSettingsResponseSchema.parse(JSON.parse(cleared.body));
      expect(clearedBody.settings).toEqual({ destination: 'local' });
      const fetchBody = LocalSettingsResponseSchema.parse(JSON.parse(fetch.body));
      expect(fetchBody.settings).toEqual({ destination: 'local' });
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
      expect(fetchedSettings.settings).toEqual({});
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
});

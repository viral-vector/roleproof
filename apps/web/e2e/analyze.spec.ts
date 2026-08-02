import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { AnalysisEnvelopeSchema, EnhancedAnalysisEnvelopeSchema } from '@roleproof/shared';

import { createDocx } from '@roleproof/test-utils';

const resumeText = [
  'Fictional Candidate',
  'Experience: Built production TypeScript APIs with Node.js.',
  'Experience: Delivered PostgreSQL-backed REST services.',
].join('\n');

const jobText = [
  'Fictional Backend Engineer',
  'Required: TypeScript',
  'Required: Node.js',
  'Required: PostgreSQL',
].join('\n');

test('runs a local deterministic analysis and downloads validated results', async ({ page }) => {
  let resumeParseRequests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/resume/parse')) resumeParseRequests += 1;
  });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /Know where you fit/ })).toBeVisible();
  await page.getByRole('link', { name: 'Start a comparison' }).click();
  await expect(page).toHaveURL(/\/analyze$/u);

  await page.getByLabel('Resume file').setInputFiles({
    name: 'fictional resume.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(resumeText),
  });
  expect(resumeParseRequests).toBe(0);
  await page.getByLabel('Job description').fill(jobText);
  await page.getByRole('button', { name: 'Analyze role fit' }).click();

  await expect(page.getByRole('heading', { name: 'Evidence summary' })).toBeVisible();
  await expect(page.getByText('Analysis progress')).toBeVisible();
  expect(resumeParseRequests).toBe(1);
  await expect(page.getByRole('heading', { name: 'Eligibility blockers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Strong matches' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Partial matches' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Safe résumé emphasis' })).toBeVisible();

  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toBe('roleproof-analysis.json');
  const jsonPath = await jsonDownload.path();
  const envelope = AnalysisEnvelopeSchema.parse(JSON.parse(await readFile(jsonPath, 'utf8')));
  expect(envelope.analysis.metadata.mode).toBe('deterministic');

  const markdownDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Markdown' }).click();
  const markdownDownload = await markdownDownloadPromise;
  expect(markdownDownload.suggestedFilename()).toBe('roleproof-analysis.md');
});

test('uploads a fictional DOCX resume and produces deterministic results', async ({ page }) => {
  let resumeParseRequests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/resume/parse')) resumeParseRequests += 1;
  });
  await page.goto('/analyze');

  await page.getByLabel('Resume file').setInputFiles({
    name: 'fictional resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(createDocx(resumeText.split('\n'))),
  });
  expect(resumeParseRequests).toBe(0);
  await page.getByLabel('Job description').fill(jobText);
  await page.getByRole('button', { name: 'Analyze role fit' }).click();

  await expect(page.getByRole('heading', { name: 'Evidence summary' })).toBeVisible();
  expect(resumeParseRequests).toBe(1);
  await expect(page.getByRole('heading', { name: 'Strong matches' })).toBeVisible();
});

test('downloads prefer the saved default export format', async ({ page }) => {
  const save = await page.request.put('/api/settings', {
    data: { defaultExportFormat: 'markdown' },
  });
  expect(save.ok()).toBeTruthy();

  await page.goto('/analyze');
  await page.getByLabel('Resume text').fill(resumeText);
  await page.getByLabel('Job description').fill(jobText);
  await page.getByRole('button', { name: 'Analyze role fit' }).click();
  await expect(page.getByRole('heading', { name: 'Evidence summary' })).toBeVisible();

  const exportButtons = page.getByRole('button', { name: /Download (JSON|Markdown)/u });
  await expect(exportButtons).toHaveCount(2);
  await expect(exportButtons.nth(0)).toHaveText('Download Markdown');

  const markdownDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Markdown' }).click();
  const markdownDownload = await markdownDownloadPromise;
  expect(markdownDownload.suggestedFilename()).toBe('roleproof-analysis.md');

  const reset = await page.request.put('/api/settings', {
    data: { defaultExportFormat: null },
  });
  expect(reset.ok()).toBeTruthy();
});

test('waits for the saved export format before enabling downloads', async ({ page }) => {
  const save = await page.request.put('/api/settings', {
    data: { defaultExportFormat: 'markdown' },
  });
  expect(save.ok()).toBeTruthy();

  let releaseSettings = () => {};
  const settingsGate = new Promise<void>((resolve) => {
    releaseSettings = resolve;
  });
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await settingsGate;
    await route.continue();
  });

  await page.goto('/analyze');
  await page.getByLabel('Resume text').fill(resumeText);
  await page.getByLabel('Job description').fill(jobText);
  await page.getByRole('button', { name: 'Analyze role fit' }).click();
  await expect(page.getByRole('heading', { name: 'Evidence summary' })).toBeVisible();

  await expect(page.getByText('Loading export preferences...')).toBeVisible();
  await expect(page.getByRole('button', { name: /Download (JSON|Markdown)/u })).toHaveCount(0);

  releaseSettings();
  const exportButtons = page.getByRole('button', { name: /Download (JSON|Markdown)/u });
  await expect(exportButtons).toHaveCount(2);
  await expect(exportButtons.nth(0)).toHaveText('Download Markdown');

  const reset = await page.request.put('/api/settings', {
    data: { defaultExportFormat: null },
  });
  expect(reset.ok()).toBeTruthy();
});

test('shows an actionable message when the resume file cannot be parsed', async ({ page }) => {
  await page.goto('/analyze');

  await page.getByLabel('Resume file').setInputFiles({
    name: 'fictional resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('PRIVATE MALFORMED DOCX'),
  });
  await page.getByLabel('Job description').fill(jobText);
  await page.getByRole('button', { name: 'Analyze role fit' }).click();

  await expect(page.getByRole('alert')).toContainText('The DOCX file could not be read');
});

test('discloses the configured AI provider, destination, endpoint, and redaction before consent', async ({
  page,
}) => {
  const save = await page.request.put('/api/settings', {
    data: {
      provider: 'openai-compatible',
      model: 'fictional-model',
      destination: 'local',
      baseUrl: 'http://localhost:11434/v1',
      redactEmployer: true,
      redactClearance: false,
      redactionTerms: ['Project Hermes'],
      structuredOutputMode: 'json-schema',
    },
  });
  expect(save.ok()).toBeTruthy();

  await page.goto('/analyze');
  await page.getByLabel('AI-enhanced analysis').check();

  await expect(page.getByText('AI transmission disclosure')).toBeVisible();
  await expect(page.getByText('OpenAI-compatible')).toBeVisible();
  await expect(page.getByText('fictional-model')).toBeVisible();
  await expect(page.getByText('http://localhost:11434/v1')).toBeVisible();
  await expect(page.getByText('Employer names')).toBeVisible();
  await expect(page.getByText('Project Hermes')).toBeVisible();

  const saveHosted = await page.request.put('/api/settings', {
    data: {
      provider: 'openai',
      model: 'fictional-model',
      destination: 'hosted',
      redactEmployer: false,
    },
  });
  expect(saveHosted.ok()).toBeTruthy();

  await page.reload();
  await page.getByLabel('AI-enhanced analysis').check();
  await expect(page.getByText('Redacted analysis inputs will leave this machine')).toBeVisible();

  const reset = await page.request.put('/api/settings', {
    data: {
      provider: null,
      model: null,
      destination: null,
      baseUrl: null,
      redactEmployer: false,
      redactClearance: false,
      redactionTerms: [],
      structuredOutputMode: null,
    },
  });
  expect(reset.ok()).toBeTruthy();
});

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the landing action and primary navigation available', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start a comparison' })).toBeVisible();
  });
});

test('renders AI enhancement sections and keeps them in exports', async ({ page }) => {
  const envelope = EnhancedAnalysisEnvelopeSchema.parse({
    schemaVersion: '2.0',
    analysis: AnalysisEnvelopeSchema.parse({
      schemaVersion: '1.0',
      analysis: {
        schemaVersion: '1.0',
        id: 'analysis-fictional-enhanced',
        overallScore: 55,
        recommendation: 'stretch',
        confidence: 0.6,
        hardBlockers: [],
        matchedRequirements: [],
        missingRequirements: [],
        unsupportedClaims: [],
        suggestedEmphasis: [],
        suggestedAdditions: [],
        interviewTopics: [],
        generatedAt: '2026-01-01T00:00:00.000Z',
        metadata: { mode: 'deterministic', engineVersion: '0.4.0' },
      },
    }).analysis,
    aiEnhancement: {
      schemaVersion: '1.0',
      baselineAnalysisId: 'analysis-fictional-enhanced',
      requirementAnalysis: {
        requirements: [
          {
            requirementId: 'r1',
            baselineClassification: 'strongly-related',
            classification: 'strongly-related',
            evidenceIds: ['ev-1'],
            explanation: 'Fictional provider interpretation.',
          },
        ],
      },
      evidenceMapping: {
        mappings: [
          {
            requirementId: 'r1',
            baselineClassification: 'strongly-related',
            classification: 'strongly-related',
            evidenceIds: ['ev-1'],
            explanation: 'Fictional evidence mapping.',
          },
        ],
      },
      applicationSuggestions: {
        suggestedEmphasis: [
          {
            text: 'Emphasize fictional TypeScript services',
            classification: 'strongly-related',
            evidenceIds: ['ev-1'],
            explanation: 'Fictional emphasis.',
          },
        ],
        suggestedAdditions: [
          {
            text: 'Add fictional project with user confirmation',
            classification: 'requires-user-confirmation',
            evidenceIds: ['ev-1'],
            explanation: 'Fictional addition.',
          },
        ],
        interviewTopics: [
          { topic: 'Fictional topic', evidenceIds: ['ev-1'], rationale: 'Fictional rationale.' },
        ],
        coverLetterAngles: [{ text: 'Fictional cover-letter angle', evidenceIds: ['ev-1'] }],
      },
      providerExecutions: [
        {
          operation: 'analyze-requirements',
          provider: 'openai-compatible',
          model: 'fictional-model',
          destination: 'local',
          manifest: {
            provider: 'openai-compatible',
            model: 'fictional-model',
            destination: 'local',
            endpointOrigin: 'http://localhost:11434',
            dataCategories: ['requirement-text'],
            redactionApplied: true,
            redactionSummary: {
              categories: [],
              replacementCount: 1,
              inputChars: 10,
              outputChars: 10,
            },
          },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costMicroUsd: null },
          requestId: 'request-fictional',
          errorCode: null,
        },
      ],
    },
  });

  await page.route('**/api/analyze/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
      body: [
        JSON.stringify({
          kind: 'progress',
          stage: 'complete',
          completed: 4,
          total: 4,
          message: 'Analysis complete.',
        }),
        JSON.stringify({ kind: 'result', response: envelope }),
      ].join('\n') + '\n',
    });
  });

  await page.goto('/analyze');
  await page.getByLabel('Resume text').fill(resumeText);
  await page.getByLabel('Job description').fill(jobText);
  await page.getByRole('button', { name: 'Analyze role fit' }).click();

  await expect(page.getByRole('heading', { name: 'Evidence summary' })).toBeVisible();
  await expect(page.getByText('AI Requirement Interpretations')).toBeVisible();
  await expect(page.getByText('AI Suggested Additions')).toBeVisible();
  await expect(page.getByText('AI Interview Topics')).toBeVisible();
  await expect(page.getByText('AI Cover-Letter Angles')).toBeVisible();
  await expect(page.getByText('Provider Metadata')).toBeVisible();
  await expect(page.getByText('fictional-model')).toBeVisible();

  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = await jsonDownload.path();
  const parsed = EnhancedAnalysisEnvelopeSchema.parse(JSON.parse(await readFile(jsonPath, 'utf8')));
  expect(parsed.schemaVersion).toBe('2.0');
  expect(parsed.aiEnhancement.providerExecutions[0]!.model).toBe('fictional-model');

  const markdownDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Markdown' }).click();
  const markdownDownload = await markdownDownloadPromise;
  const markdownPath = await markdownDownload.path();
  expect(await readFile(markdownPath, 'utf8')).toContain('## AI Enhancement');
});

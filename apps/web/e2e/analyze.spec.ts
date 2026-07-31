import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { AnalysisEnvelopeSchema } from '@roleproof/shared';

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

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the landing action and primary navigation available', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start a comparison' })).toBeVisible();
  });
});

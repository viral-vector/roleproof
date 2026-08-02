import { expect, test } from '@playwright/test';

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

const analystJobText = [
  'Fictional Data Analyst',
  '',
  'Required Qualifications',
  '- SQL',
  '- Python',
  '- Tableau',
].join('\n');

test.beforeEach(async ({ page }) => {
  const history = await page.request.get('/api/history');
  const body = (await history.json()) as { history: Array<{ id: string }> };
  for (const item of body.history) {
    await page.request.delete(`/api/history/${item.id}`);
  }
});

test('stores analyzed reports in history with search and detail', async ({ page }) => {
  await page.goto('/analyze');
  await page.getByLabel('Resume text').fill(resumeText);
  await page.getByLabel('Job description').fill(jobText);
  await page.getByRole('button', { name: 'Analyze role fit' }).click();
  await expect(page.getByRole('heading', { name: 'Evidence summary' })).toBeVisible();

  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page).toHaveURL(/\/history$/u);
  await expect(page.getByRole('heading', { name: 'Analysis history' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open' })).toBeVisible();

  await page.getByLabel('Search history').fill('fictional');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name: 'Open' })).toBeVisible();

  await page.getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/history\/analysis-/u);
  await expect(page.getByRole('heading', { name: 'Evidence summary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Eligibility blockers' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete this report' }).click();
  await expect(page).toHaveURL(/\/history$/u);
  await expect(page.getByText('No stored analyses yet.')).toBeVisible();
});

test('searches history by distinct job text and the stored recommendation', async ({ page }) => {
  await page.goto('/analyze');
  await page.getByLabel('Resume text').fill(resumeText);
  await page.getByLabel('Job description').fill(jobText);
  await page.getByRole('button', { name: 'Analyze role fit' }).click();
  await expect(page.getByRole('heading', { name: 'Evidence summary' })).toBeVisible();

  await page.getByLabel('Resume text').fill(resumeText);
  await page.getByLabel('Job description').fill(analystJobText);
  await page.getByRole('button', { name: 'Analyze role fit' }).click();
  await expect(page.getByRole('heading', { name: 'Evidence summary' })).toBeVisible();

  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open' })).toHaveCount(2);

  await page.getByLabel('Search history').fill('tableau');
  await page.getByRole('button', { name: 'Search' }).click();
  const tableauRow = page.locator('.history-row');
  await expect(tableauRow).toHaveCount(1);
  const tableauOpen = await tableauRow.getByRole('link', { name: 'Open' }).getAttribute('href');

  await page.getByLabel('Search history').fill('backend');
  await page.getByRole('button', { name: 'Search' }).click();
  const backendRow = page.locator('.history-row');
  await expect(backendRow).toHaveCount(1);
  await expect(backendRow).toContainText('apply');
  const backendOpen = await backendRow.getByRole('link', { name: 'Open' }).getAttribute('href');
  expect(backendOpen).not.toBe(tableauOpen);

  await page.getByLabel('Search history').fill('apply');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('apply', { exact: true })).toBeVisible();
});

test('persists settings changes and reflects them when reopening the page', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.getByLabel('Default export format').selectOption('markdown');
  await page.getByLabel('Redact employer names').check();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved locally.');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeVisible();
  await expect(page.getByLabel('Default export format')).toHaveValue('markdown');
  await expect(page.getByLabel('Redact employer names')).toBeChecked();

  await page.getByLabel('Default export format').selectOption('');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved locally.');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeVisible();
  await expect(page.getByLabel('Default export format')).toHaveValue('');

  await page.getByLabel('Provider', { exact: true }).selectOption('openai');
  await page.getByLabel('Model', { exact: true }).fill('fictional-model');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved locally.');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeVisible();
  await expect(page.getByLabel('Provider', { exact: true })).toHaveValue('openai');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('fictional-model');

  await page.getByLabel('Provider', { exact: true }).selectOption('');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved locally.');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeVisible();
  await expect(page.getByLabel('Provider', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('');
});

import { defineConfig, devices } from '@playwright/test';

const port = 4174;
const isCI = process.env['CI'] !== undefined;

export default defineConfig({
  testDir: './apps/web/e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  ...(isCI ? { workers: 1 } : {}),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm exec roleproof serve --host 127.0.0.1 --port ${String(port)}`,
    url: `http://127.0.0.1:${String(port)}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

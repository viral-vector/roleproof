import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    hookTimeout: 15_000,
    include: ['apps/**/test/**/*.test.ts', 'packages/**/test/**/*.test.ts'],
    testTimeout: 15_000,
  },
});

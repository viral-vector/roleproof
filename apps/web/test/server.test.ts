import { describe, expect, it } from 'vitest';

import { createLocalWebApp, DEFAULT_SERVE_HOST, DEFAULT_SERVE_PORT } from '../src/server.js';
import type { LocalHealthResponse } from '../src/server.js';

describe('local web server foundation', () => {
  it('exposes a local-only health endpoint without requiring an account or provider', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      const body = JSON.parse(response.body) as LocalHealthResponse;

      expect(response.statusCode).toBe(200);
      expect(body).toEqual({
        schemaVersion: '1.0',
        status: 'ok',
        mode: 'local',
        accountRequired: false,
        cloudRequired: false,
      });
    } finally {
      await app.close();
    }
  });

  it('documents the Phase 4 default local address', () => {
    expect(DEFAULT_SERVE_HOST).toBe('localhost');
    expect(DEFAULT_SERVE_PORT).toBe(4173);
  });
});

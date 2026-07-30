import { describe, expect, it } from 'vitest';
import { LocalAnalyzeResponseSchema } from '@roleproof/shared';

import { createLocalWebApp, DEFAULT_SERVE_HOST, DEFAULT_SERVE_PORT } from '../src/server.js';
import type { LocalHealthResponse } from '../src/server.js';

describe('local web server foundation', () => {
  it('serves the local Vue UI shell without requiring a cloud connection', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('<div id="app"></div>');
      expect(response.body).toContain('RoleProof Local');
      expect(response.body).not.toMatch(/<header[\s>]/);
      expect(response.body).toContain('rel="icon"');
      expect(response.body).toContain('/favicon.svg');
    } finally {
      await app.close();
    }
  });

  it('serves the local favicon as an SVG asset', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/favicon.svg' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/svg+xml');
      expect(response.body).toContain('<svg');
      expect(response.body).toContain('<title>RoleProof Local</title>');
      expect(response.body).toContain('id="proof-mark"');
      expect(response.body).not.toContain('<div id="app"></div>');
    } finally {
      await app.close();
    }
  });

  it('serves a cache-busted favicon request as SVG instead of the UI shell', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/favicon.svg?v=2' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/svg+xml');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.body).toContain('<svg');
      expect(response.body).not.toContain('<div id="app"></div>');
    } finally {
      await app.close();
    }
  });

  it('falls back to the UI shell for local browser routes', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/results/fictional-analysis' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('RoleProof Local');
    } finally {
      await app.close();
    }
  });

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

  it('runs deterministic analysis through the shared core contract', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/analyze',
        payload: {
          schemaVersion: '1.0',
          mode: 'deterministic',
          resumeText: [
            'Fictional Candidate',
            'Experience: Built production TypeScript APIs with Node.js.',
            'Experience: Delivered PostgreSQL-backed REST services.',
          ].join('\n'),
          jobText: [
            'Fictional Backend Engineer',
            'Required: TypeScript',
            'Required: Node.js',
            'Required: PostgreSQL',
          ].join('\n'),
        },
      });
      const body = LocalAnalyzeResponseSchema.parse(JSON.parse(response.body));

      expect(response.statusCode).toBe(200);
      expect(body.schemaVersion).toBe('1.0');
      expect(body.analysis.metadata.mode).toBe('deterministic');
      expect(body.analysis.matchedRequirements.length).toBeGreaterThan(0);
      expect(response.body).not.toContain('aiEnhancement');
    } finally {
      await app.close();
    }
  });

  it('rejects malformed local analyze requests without running analysis', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/analyze',
        payload: { schemaVersion: '1.0', resumeText: '   ', jobText: 'Required: TypeScript' },
      });
      const body = JSON.parse(response.body) as { error: string };

      expect(response.statusCode).toBe(400);
      expect(body).toEqual({ error: 'Invalid analyze request.' });
    } finally {
      await app.close();
    }
  });
});

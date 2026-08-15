import { describe, expect, it, vi } from 'vitest';
import {
  AutomationApiManifestSchema,
  LocalAnalyzeResponseSchema,
  LocalResumeParseResponseSchema,
} from '@roleproof/shared';
import { createDocx, createPdf } from '@roleproof/test-utils';

import { createLocalWebApp, DEFAULT_SERVE_HOST, DEFAULT_SERVE_PORT } from '../src/server.js';
import type { LocalHealthResponse } from '../src/server.js';

function multipartResume(filename: string, mediaType: string, content: string | Uint8Array) {
  const boundary = 'roleproof-test-boundary';
  const prefix = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="resume"; filename="${filename}"`,
    `Content-Type: ${mediaType}`,
    '',
    '',
  ].join('\r\n');
  const suffix = `\r\n--${boundary}--\r\n`;
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([Buffer.from(prefix), Buffer.from(bytes), Buffer.from(suffix)]),
  };
}

function mockedJobPageFetch(): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(
      new Response(
        '<html><body><main><h1>Fictional Backend Engineer</h1><p>Required: TypeScript</p></main></body></html>',
        {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        },
      ),
    ),
  ) as typeof fetch;
}

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

  it('exposes a stable local automation API manifest', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/api/automation' });
      const body = AutomationApiManifestSchema.parse(JSON.parse(response.body));

      expect(response.statusCode).toBe(200);
      expect(body.mode).toBe('local');
      expect(body.endpoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: 'POST', path: '/api/automation/analyze' }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('runs automation HTTP analysis without persisting or requiring storage', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/automation/analyze',
        payload: {
          schemaVersion: '1.0',
          resumeText: 'Fictional Candidate\nExperience: Built TypeScript APIs with Node.js.',
          jobText: 'Required: TypeScript\nRequired: Node.js',
        },
      });
      const body = LocalAnalyzeResponseSchema.parse(JSON.parse(response.body));

      expect(response.statusCode).toBe(200);
      expect(body.schemaVersion).toBe('1.0');
      expect(body.analysis.metadata.mode).toBe('deterministic');
      expect(body.analysis.matchedRequirements.length).toBeGreaterThan(0);
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

  it('resolves a job URL into fetched job content and source metadata', async () => {
    const app = createLocalWebApp({
      jobUrlFetch: mockedJobPageFetch(),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/analyze',
        payload: {
          schemaVersion: '1.0',
          mode: 'deterministic',
          resumeText: 'Fictional Candidate\nExperience: TypeScript',
          jobText: '',
          jobUrl: 'https://boards.greenhouse.io/fictionalco/jobs/123',
        },
      });
      expect(response.statusCode).toBe(200);
      if (response.statusCode !== 200) {
        throw new Error(response.body);
      }
      const body = LocalAnalyzeResponseSchema.parse(JSON.parse(response.body));
      expect(body.analysis.metadata.jobSource).toMatchObject({
        url: 'https://boards.greenhouse.io/fictionalco/jobs/123',
        removedOrUnavailable: false,
      });
      expect(body.analysis.metadata.jobSource?.sourceClassification).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('streams progress and a final analysis response for deterministic runs', async () => {
    const app = createLocalWebApp({ jobUrlFetch: mockedJobPageFetch() });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/analyze/stream',
        payload: {
          schemaVersion: '1.0',
          mode: 'deterministic',
          resumeText: ['Fictional Candidate', 'Experience: TypeScript'].join('\n'),
          jobText: '',
          jobUrl: 'https://boards.greenhouse.io/fictionalco/jobs/123',
        },
      });
      const lines = response.body
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { kind: string });

      expect(response.statusCode).toBe(200);
      expect(lines[0]?.kind).toBe('progress');
      expect(lines.at(-1)?.kind).toBe('result');
      const result = lines.at(-1) as { kind: 'result'; response: unknown };
      const body = LocalAnalyzeResponseSchema.parse(result.response);
      expect(body.schemaVersion).toBe('1.0');
      expect(body.analysis.metadata.jobSource).toMatchObject({
        url: 'https://boards.greenhouse.io/fictionalco/jobs/123',
        removedOrUnavailable: false,
      });
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

  it('extracts a bounded plaintext resume only after an explicit multipart request', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/resume/parse',
        ...multipartResume(
          'fictional resume.txt',
          'text/plain',
          'Fictional TypeScript and PostgreSQL experience.',
        ),
      });
      const body = LocalResumeParseResponseSchema.parse(JSON.parse(response.body));

      expect(response.statusCode).toBe(200);
      expect(body.format).toBe('plaintext');
      expect(body.text).toContain('Fictional TypeScript');
    } finally {
      await app.close();
    }
  });

  it('rejects unsupported resume uploads without echoing private content', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/resume/parse',
        ...multipartResume('fictional resume.rtf', 'application/octet-stream', 'PRIVATE CONTENT'),
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ error: 'Invalid resume file.' });
      expect(response.body).not.toContain('PRIVATE CONTENT');
    } finally {
      await app.close();
    }
  });

  it('extracts a fictional DOCX resume through the bounded parser', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/resume/parse',
        ...multipartResume(
          'fictional resume.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          createDocx(['Fictional TypeScript and PostgreSQL experience']),
        ),
      });
      const body = LocalResumeParseResponseSchema.parse(JSON.parse(response.body));

      expect(response.statusCode).toBe(200);
      expect(body.format).toBe('docx');
      expect(body.text).toContain('Fictional TypeScript');
    } finally {
      await app.close();
    }
  });

  it('rejects malformed DOCX uploads with a content-free reason code', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/resume/parse',
        ...multipartResume(
          'fictional resume.docx',
          'application/octet-stream',
          'PRIVATE MALFORMED DOCX',
        ),
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Invalid resume file.',
        code: 'docx-error',
      });
      expect(response.body).not.toContain('PRIVATE MALFORMED DOCX');
    } finally {
      await app.close();
    }
  });

  it('rejects a DOCX with no readable text using a content-free reason code', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/resume/parse',
        ...multipartResume(
          'fictional resume.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          createDocx([]),
        ),
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Invalid resume file.',
        code: 'empty-document',
      });
    } finally {
      await app.close();
    }
  });

  it('logs content-free parse failure reasons to stderr', async () => {
    const app = createLocalWebApp();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await app.inject({
        method: 'POST',
        url: '/api/resume/parse',
        ...multipartResume(
          'fictional resume.docx',
          'application/octet-stream',
          'PRIVATE MALFORMED DOCX',
        ),
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]![0]).toContain('docx-error');
      expect(errorSpy.mock.calls[0]![0]).not.toContain('PRIVATE MALFORMED DOCX');
    } finally {
      errorSpy.mockRestore();
      await app.close();
    }
  });

  it('extracts a fictional PDF resume through the bounded parser', async () => {
    const app = createLocalWebApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/resume/parse',
        ...multipartResume(
          'fictional resume.pdf',
          'application/pdf',
          createPdf(['Fictional TypeScript and PostgreSQL experience']),
        ),
      });
      const body = LocalResumeParseResponseSchema.parse(JSON.parse(response.body));

      expect(response.statusCode).toBe(200);
      expect(body.format).toBe('pdf');
      expect(body.text).toContain('Fictional TypeScript');
    } finally {
      await app.close();
    }
  });

  it('rejects malformed PDFs and oversized plaintext without echoing content', async () => {
    const app = createLocalWebApp();

    try {
      const malformed = await app.inject({
        method: 'POST',
        url: '/api/resume/parse',
        ...multipartResume('fictional resume.pdf', 'application/pdf', 'PRIVATE MALFORMED PDF'),
      });
      const oversized = await app.inject({
        method: 'POST',
        url: '/api/resume/parse',
        ...multipartResume('fictional resume.txt', 'text/plain', 'x'.repeat(1_000_001)),
      });

      expect(malformed.statusCode).toBe(400);
      expect(oversized.statusCode).toBe(400);
      expect(JSON.parse(malformed.body)).toEqual({
        error: 'Invalid resume file.',
        code: 'pdf-error',
      });
      expect(JSON.parse(oversized.body)).toEqual({ error: 'Invalid resume file.' });
      expect(malformed.body).not.toContain('PRIVATE MALFORMED PDF');
      expect(oversized.body).not.toContain('x'.repeat(100));
    } finally {
      await app.close();
    }
  });
});

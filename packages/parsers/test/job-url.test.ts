import { describe, expect, it, vi } from 'vitest';

import { parseJobUrlWithMetadata } from '../src/index.js';

function makeResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? { 'content-type': 'text/html; charset=utf-8' }),
  });
}

describe('parseJobUrlWithMetadata', () => {
  it('extracts text and classifies a greenhouse job page', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse(
          `<!doctype html><html><body><h1>Backend Engineer</h1><p>TypeScript</p><p>Node.js</p></body></html>`,
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        ),
      );

    const result = await parseJobUrlWithMetadata(
      'https://boards.greenhouse.io/fictionalco/jobs/123',
      { maxUrlBytes: 100_000, urlTimeoutMs: 1_000, maxUrlRedirects: 3 },
      fetchImpl,
    );

    expect(result.document.kind).toBe('job');
    expect(result.document.format).toBe('plaintext');
    expect(result.document.text).toContain('Backend Engineer');
    expect(result.source.sourceClassification).toBe('official-ats');
    expect(result.source.atsProvider).toBe('greenhouse');
    expect(result.source.removedOrUnavailable).toBe(false);
    expect(result.contentSha256).toHaveLength(64);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('follows redirects up to the configured limit', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse('', {
          status: 302,
          headers: { location: 'https://example.com/job-two' },
        }),
      )
      .mockResolvedValueOnce(makeResponse('<html><body>Fictional role</body></html>'));

    const result = await parseJobUrlWithMetadata(
      'https://example.com/job-one',
      { maxUrlBytes: 100_000, urlTimeoutMs: 1_000, maxUrlRedirects: 3 },
      fetchImpl,
    );

    expect(result.source.finalUrl).toBe('https://example.com/job-two');
  });

  it('rejects removed or unavailable pages', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse('Not found', {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );

    await expect(
      parseJobUrlWithMetadata(
        'https://example.com/job',
        { maxUrlBytes: 100_000, urlTimeoutMs: 1_000, maxUrlRedirects: 3 },
        fetchImpl,
      ),
    ).rejects.toMatchObject({
      code: 'removed-unavailable',
    });
  });

  it('rejects unsupported content types', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse('%PDF', {
        headers: { 'content-type': 'application/pdf' },
      }),
    );

    await expect(
      parseJobUrlWithMetadata(
        'https://example.com/job',
        { maxUrlBytes: 100_000, urlTimeoutMs: 1_000, maxUrlRedirects: 3 },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: 'content-type-unsupported' });
  });

  it('rejects oversized job pages before parsing them', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse('x'.repeat(20), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );

    await expect(
      parseJobUrlWithMetadata(
        'https://example.com/job',
        { maxUrlBytes: 10, urlTimeoutMs: 1_000, maxUrlRedirects: 3 },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: 'fetch-size-limit' });
  });

  it('rejects job URLs with unsupported protocols', async () => {
    await expect(
      parseJobUrlWithMetadata('ftp://example.com/job', {
        maxUrlBytes: 100_000,
        urlTimeoutMs: 1_000,
        maxUrlRedirects: 3,
      }),
    ).rejects.toMatchObject({ code: 'url-unsupported-protocol' });
  });

  it('rejects malformed job URLs', async () => {
    await expect(
      parseJobUrlWithMetadata('not-a-url', {
        maxUrlBytes: 100_000,
        urlTimeoutMs: 1_000,
        maxUrlRedirects: 3,
      }),
    ).rejects.toMatchObject({ code: 'url-invalid' });
  });
});

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
    expect(result.source.contentType).toBe('text/html; charset=utf-8');
    expect(result.contentSha256).toHaveLength(64);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('classifies a structured employer careers page without treating every unknown host as official', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(`
        <html><body>
          <main>
            <h1>Fictional Platform Engineer</h1>
            <h2>Required Qualifications</h2>
            <p>Experience building TypeScript services.</p>
          </main>
        </body></html>
      `),
    );

    const result = await parseJobUrlWithMetadata(
      'https://careers.fictional.example/jobs/platform-engineer',
      {},
      fetchImpl,
    );

    expect(result.source.sourceClassification).toBe('official-employer');
    expect(result.source.atsProvider).toBe('unknown');
    expect(result.source.removedOrUnavailable).toBe(false);
  });

  it('extracts only the Greenhouse job content and excludes its application form', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(`
        <html><body>
          <div id="content">
            <h1>Fictional Platform Engineer</h1>
            <h2>What do we need from you?</h2>
            <ul><li>Experience building Node.js services.</li></ul>
          </div>
          <div id="application">
            <form><label>What is your preferred programming language? *</label></form>
          </div>
        </body></html>
      `),
    );

    const result = await parseJobUrlWithMetadata(
      'https://job-boards.greenhouse.io/fictionalco/jobs/123',
      {},
      fetchImpl,
    );

    expect(result.document.text).toContain('Experience building Node.js services.');
    expect(result.document.text).not.toContain('preferred programming language');
  });

  it('extracts the Lever job-description container without page chrome', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(`
        <html><body>
          <nav>Browse all fictional jobs</nav>
          <main class="posting-page">
            <section data-qa="job-description">
              <h1>Fictional Backend Engineer</h1>
              <p>Required: TypeScript</p>
            </section>
            <aside>Share this job</aside>
          </main>
        </body></html>
      `),
    );

    const result = await parseJobUrlWithMetadata(
      'https://jobs.lever.co/fictionalco/abc123',
      {},
      fetchImpl,
    );

    expect(result.document.text).toContain('Required: TypeScript');
    expect(result.document.text).not.toContain('Browse all fictional jobs');
    expect(result.document.text).not.toContain('Share this job');
  });

  it('prefers Ashby JobPosting JSON-LD over application page content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(`
        <html><head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "JobPosting",
              "title": "Fictional API Engineer",
              "description": "<h2>Requirements</h2><ul><li>PostgreSQL</li></ul>"
            }
          </script>
        </head><body>
          <div>What is your preferred programming language? *</div>
        </body></html>
      `),
    );

    const result = await parseJobUrlWithMetadata(
      'https://jobs.ashbyhq.com/fictionalco/abc123',
      {},
      fetchImpl,
    );

    expect(result.document.text).toContain('Fictional API Engineer');
    expect(result.document.text).toContain('PostgreSQL');
    expect(result.document.text).not.toContain('preferred programming language');
  });

  it('selects the JSON-LD posting whose canonical URL matches the fetched page', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(`
        <html><head><script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@graph": [
              { "@type": "JobPosting", "url": "https://jobs.ashbyhq.com/fictionalco/wrong" },
              {
                "@type": "JobPosting",
                "url": "https://jobs.ashbyhq.com/fictionalco/wrong-two",
                "title": "Wrong Related Job",
                "description": "<p>Wrong requirement</p>"
              },
              {
                "@type": "JobPosting",
                "url": "https://jobs.ashbyhq.com/fictionalco/right",
                "title": "Right Fictional Job",
                "description": "<p>Required: TypeScript</p>"
              }
            ]
          }
        </script></head><body><main>Fallback page</main></body></html>
      `),
    );

    const result = await parseJobUrlWithMetadata(
      'https://jobs.ashbyhq.com/fictionalco/right',
      {},
      fetchImpl,
    );

    expect(result.document.text).toContain('Right Fictional Job');
    expect(result.document.text).not.toContain('Wrong Related Job');
  });

  it('preserves structured JSON-LD salary and applicant location fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(`
        <html><head><script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "url": "https://jobs.ashbyhq.com/fictionalco/structured",
            "title": "Fictional Remote Engineer",
            "description": "<p>Required: Node.js</p>",
            "jobLocationType": "TELECOMMUTE",
            "applicantLocationRequirements": { "@type": "Country", "name": "United States" },
            "baseSalary": {
              "@type": "MonetaryAmount",
              "currency": "USD",
              "value": {
                "@type": "QuantitativeValue",
                "minValue": 120000,
                "maxValue": 150000,
                "unitText": "YEAR"
              }
            }
          }
        </script></head><body></body></html>
      `),
    );

    const result = await parseJobUrlWithMetadata(
      'https://jobs.ashbyhq.com/fictionalco/structured',
      {},
      fetchImpl,
    );

    expect(result.document.text).toContain('Salary: USD 120000-150000 annually.');
    expect(result.document.text).toContain('Location: Remote - United States.');
  });

  it('removes forms and page chrome from a generic semantic job page', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(`
        <html><body>
          <nav>Company navigation</nav>
          <main><article>
            <h1>Fictional Data Engineer</h1>
            <h2>Required Qualifications</h2>
            <p>Python</p>
            <form><label>First Name *</label><label>Current salary *</label></form>
          </article></main>
          <footer>Privacy and legal links</footer>
        </body></html>
      `),
    );

    const result = await parseJobUrlWithMetadata(
      'https://careers.fictional.example/jobs/data-engineer',
      {},
      fetchImpl,
    );

    expect(result.document.text).toContain('Required Qualifications');
    expect(result.document.text).not.toContain('First Name');
    expect(result.document.text).not.toContain('Company navigation');
    expect(result.document.text).not.toContain('Privacy and legal links');
  });

  it('preserves form-wrapped job content while excluding controls and malformed form tails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(`
        <html><body><form method="post">
          <article>
            <h1>Fictional Systems Engineer</h1>
            <p>Required: Linux</p>
          </article>
          <label>Current salary *</label>
          <input name="salary">
      `),
    );

    const result = await parseJobUrlWithMetadata(
      'https://careers.fictional.example/jobs/systems-engineer',
      {},
      fetchImpl,
    );

    expect(result.document.text).toContain('Required: Linux');
    expect(result.document.text).not.toContain('Current salary');
  });

  it('decodes common named entities and safely replaces invalid numeric entities', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(`
        <main>
          <h2>What you&rsquo;ll bring</h2>
          <p>TypeScript &#99999999;</p>
        </main>
      `),
    );

    const result = await parseJobUrlWithMetadata(
      'https://careers.fictional.example/jobs/entities',
      {},
      fetchImpl,
    );

    expect(result.document.text).toContain('What you’ll bring');
    expect(result.document.text).toContain('TypeScript');
  });

  it('warns when extraction falls back to whole-document text', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse(
          '<html><body><div><h1>Fictional Engineer</h1><p>TypeScript</p></div></body></html>',
        ),
      );

    const result = await parseJobUrlWithMetadata(
      'https://careers.fictional.example/jobs/fallback',
      {},
      fetchImpl,
    );

    expect(result.source.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'generic-extraction' })]),
    );
  });

  it('warns when extraction uses a semantic main container without job structure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse(
          '<html><body><main><h1>Fictional Engineer</h1><p>TypeScript</p></main></body></html>',
        ),
      );

    const result = await parseJobUrlWithMetadata(
      'https://careers.fictional.example/jobs/semantic',
      {},
      fetchImpl,
    );

    expect(result.source.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'semantic-extraction' })]),
    );
  });

  it('does not warn for structured JSON-LD or recognized job containers', async () => {
    const jsonLdFetch = vi.fn().mockResolvedValue(
      makeResponse(`
        <html><head><script type="application/ld+json">
          {"@context":"https://schema.org","@type":"JobPosting","title":"Fictional Engineer","description":"<p>TypeScript</p>"}
        </script></head><body><div>Unrelated page content</div></body></html>
      `),
    );
    const jsonLd = await parseJobUrlWithMetadata(
      'https://jobs.ashbyhq.com/fictionalco/abc123',
      {},
      jsonLdFetch,
    );

    expect(jsonLd.source.warnings.map((warning) => warning.code)).not.toContain(
      'generic-extraction',
    );
    expect(jsonLd.source.warnings.map((warning) => warning.code)).not.toContain(
      'semantic-extraction',
    );

    const containerFetch = vi.fn().mockResolvedValue(
      makeResponse(`
        <html><body><main><section data-qa="job-description"><p>TypeScript</p></section></main></body></html>
      `),
    );
    const container = await parseJobUrlWithMetadata(
      'https://jobs.lever.co/fictionalco/abc123',
      {},
      containerFetch,
    );

    expect(container.source.warnings.map((warning) => warning.code)).not.toContain(
      'generic-extraction',
    );
    expect(container.source.warnings.map((warning) => warning.code)).not.toContain(
      'semantic-extraction',
    );
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

  it.each([
    'http://localhost/job',
    'http://127.0.0.1/job',
    'http://10.0.0.5/job',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/job',
    'https://user:secret@example.com/job',
  ])('rejects unsafe job URL destination %s before fetching', async (url) => {
    const fetchImpl = vi.fn();

    await expect(parseJobUrlWithMetadata(url, {}, fetchImpl)).rejects.toMatchObject({
      code: 'url-unsafe-destination',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an unsafe redirect destination before the second fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      makeResponse('', {
        status: 302,
        headers: { location: 'http://127.0.0.1/private' },
      }),
    );

    await expect(
      parseJobUrlWithMetadata('https://example.com/job', {}, fetchImpl),
    ).rejects.toMatchObject({ code: 'url-unsafe-destination' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('applies the URL timeout while reading a stalled response body', async () => {
    vi.useFakeTimers();
    let settled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );
    const outcome = parseJobUrlWithMetadata(
      'https://example.com/job',
      { urlTimeoutMs: 50 },
      fetchImpl,
    ).then(
      () => 'resolved',
      (error: unknown) => (error as { code?: string }).code,
    );
    void outcome.finally(() => {
      settled = true;
    });

    try {
      await vi.advanceTimersByTimeAsync(51);
      expect(settled).toBe(true);
      await expect(outcome).resolves.toBe('fetch-timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([401, 403, 500, 503])('rejects HTTP %s pages before analysis', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse('Error page', { status }));

    await expect(
      parseJobUrlWithMetadata('https://example.com/job', {}, fetchImpl),
    ).rejects.toMatchObject({ code: 'fetch-failed' });
  });

  it('rejects a successful response that says the position was removed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse('<main>This position has been filled.</main>'));

    await expect(
      parseJobUrlWithMetadata('https://example.com/job', {}, fetchImpl),
    ).rejects.toMatchObject({ code: 'removed-unavailable' });
  });

  it('classifies an unverifiable hostname as unknown', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse('<main>Fictional role</main>'));

    const result = await parseJobUrlWithMetadata('https://jobs.example.com/role', {}, fetchImpl);

    expect(result.source.sourceClassification).toBe('unknown');
    expect(result.source.confidence).toBeLessThan(1);
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

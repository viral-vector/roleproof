import { describe, expect, it } from 'vitest';

import { extractJobPageTextWithProvenance } from '../src/index.js';

describe('extractJobPageTextWithProvenance', () => {
  it('reports json-ld extraction for JobPosting structured data', () => {
    const extraction = extractJobPageTextWithProvenance(
      `<html><head><script type="application/ld+json">
        {"@context":"https://schema.org","@type":"JobPosting","title":"Fictional Engineer","description":"<p>TypeScript</p>"}
      </script></head><body><main>Other content</main></body></html>`,
      'https://jobs.ashbyhq.com/fictionalco/abc',
    );

    expect(extraction.method).toBe('json-ld');
    expect(extraction.text).toContain('TypeScript');
    expect(extraction.text).not.toContain('Other content');
  });

  it('reports container extraction for a recognized job-description container', () => {
    const extraction = extractJobPageTextWithProvenance(
      '<html><body><main><section data-qa="job-description"><p>TypeScript</p></section></main></body></html>',
      'https://jobs.lever.co/fictionalco/abc',
    );

    expect(extraction.method).toBe('container');
    expect(extraction.text).toContain('TypeScript');
  });

  it('reports semantic extraction for main or article content without job structure', () => {
    const extraction = extractJobPageTextWithProvenance(
      '<html><body><main><h1>Fictional Engineer</h1><p>TypeScript</p></main></body></html>',
      'https://careers.fictional.example/jobs/1',
    );

    expect(extraction.method).toBe('semantic');
    expect(extraction.text).toContain('TypeScript');
  });

  it('reports fallback extraction for whole-document content', () => {
    const extraction = extractJobPageTextWithProvenance(
      '<html><body><div><h1>Fictional Engineer</h1><p>TypeScript</p></div></body></html>',
      'https://careers.fictional.example/jobs/2',
    );

    expect(extraction.method).toBe('fallback');
    expect(extraction.text).toContain('TypeScript');
  });
});

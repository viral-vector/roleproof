import { extractRawText } from 'mammoth';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('mammoth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mammoth')>();
  return { ...actual, extractRawText: vi.fn(actual.extractRawText) };
});

import { DEFAULT_PARSER_CONFIG, ParserError, parseDocx } from '../src/index.js';
import { createDocx } from '@roleproof/test-utils';

const extractRawTextMock = vi.mocked(extractRawText);

describe('parseDocx', () => {
  afterEach(() => {
    extractRawTextMock.mockClear();
  });

  it('extracts text from a fictional resume DOCX', async () => {
    const result = await parseDocx(
      createDocx([
        'Fictional Candidate',
        'Experience: Built production TypeScript APIs with Node.js.',
      ]),
      'resume',
    );

    expect(result.schemaVersion).toBe('1.0');
    expect(result.kind).toBe('resume');
    expect(result.format).toBe('docx');
    expect(result.text).toContain('Fictional Candidate');
    expect(result.text).toContain('Built production TypeScript APIs with Node.js');
    expect(result.confidence).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it('rejects malformed and text-empty DOCX files safely', async () => {
    await expect(
      parseDocx(new TextEncoder().encode('not a docx archive'), 'resume'),
    ).rejects.toEqual(expect.objectContaining<Partial<ParserError>>({ code: 'docx-error' }));
    await expect(parseDocx(createDocx([]), 'resume')).rejects.toEqual(
      expect.objectContaining<Partial<ParserError>>({ code: 'empty-document' }),
    );
  });

  it('enforces the DOCX byte limit before extraction', async () => {
    const input = createDocx(['Fictional resume text']);

    await expect(
      parseDocx(input, 'resume', { ...DEFAULT_PARSER_CONFIG, maxDocxBytes: 4 }),
    ).rejects.toEqual(expect.objectContaining<Partial<ParserError>>({ code: 'size-limit' }));
    expect(extractRawTextMock).not.toHaveBeenCalled();
  });

  it('enforces the extracted text byte limit', async () => {
    await expect(
      parseDocx(createDocx(['Extracted text exceeds the configured text limit']), 'resume', {
        ...DEFAULT_PARSER_CONFIG,
        maxTextBytes: 8,
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<ParserError>>({ code: 'size-limit' }));
  });

  it('rejects DOCX job input', async () => {
    await expect(parseDocx(createDocx(['Fictional job text']), 'job')).rejects.toEqual(
      expect.objectContaining<Partial<ParserError>>({ code: 'unsupported-format' }),
    );
  });

  it('flags very short DOCX extraction as low-confidence text', async () => {
    const result = await parseDocx(createDocx(['Short']), 'resume');

    expect(result.confidence).toBe(0.5);
    expect(result.warnings).toEqual([
      { code: 'docx-low-text-content', message: 'DOCX contains very little extractable text.' },
    ]);
  });
});

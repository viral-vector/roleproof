import { extractText, getResolvedPDFJS } from 'unpdf';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('unpdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('unpdf')>();
  return {
    ...actual,
    extractText: vi.fn(actual.extractText),
    getResolvedPDFJS: vi.fn(actual.getResolvedPDFJS),
  };
});

import { DEFAULT_PARSER_CONFIG, ParserError, parsePdf } from '../src/index.js';

function escapePdfText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function createPdf(pages: string[]): Uint8Array {
  const objects: string[] = [];
  const pageObjectNumbers = pages.map((_, index) => 4 + index * 2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  for (const [index, text] of pages.entries()) {
    const contentObjectNumber = 5 + index * 2;
    const content = `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }

  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(document.length);
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = document.length;
  document += `xref\n0 ${objects.length + 1}\n`;
  document += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    document += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(document);
}

describe('parsePdf', () => {
  afterEach(() => {
    vi.mocked(extractText).mockClear();
    vi.mocked(getResolvedPDFJS).mockClear();
  });

  it('extracts text from a fictional resume PDF', async () => {
    const result = await parsePdf(
      createPdf(['Fictional TypeScript and PostgreSQL experience']),
      'resume',
    );

    expect(result.schemaVersion).toBe('1.0');
    expect(result.kind).toBe('resume');
    expect(result.format).toBe('pdf');
    expect(result.text).toContain('Fictional TypeScript and PostgreSQL experience');
  });

  it('rejects malformed and text-empty PDFs safely', async () => {
    await expect(parsePdf(new TextEncoder().encode('not a PDF'), 'resume')).rejects.toEqual(
      expect.objectContaining<Partial<ParserError>>({ code: 'pdf-error' }),
    );
    await expect(parsePdf(createPdf(['']), 'resume')).rejects.toEqual(
      expect.objectContaining<Partial<ParserError>>({ code: 'empty-document' }),
    );
  });

  it('enforces byte and page limits before unbounded extraction', async () => {
    await expect(
      parsePdf(createPdf(['Page one']), 'resume', {
        ...DEFAULT_PARSER_CONFIG,
        maxPdfBytes: 4,
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<ParserError>>({ code: 'size-limit' }));
    await expect(
      parsePdf(createPdf(['Page one', 'Page two']), 'resume', {
        ...DEFAULT_PARSER_CONFIG,
        maxPdfPages: 1,
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<ParserError>>({ code: 'pdf-page-limit' }));
    await expect(
      parsePdf(createPdf(['Extracted text exceeds the configured text limit']), 'resume', {
        ...DEFAULT_PARSER_CONFIG,
        maxTextBytes: 8,
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<ParserError>>({ code: 'size-limit' }));
  });

  it('rejects PDF job input in Phase 1', async () => {
    await expect(parsePdf(createPdf(['Fictional job']), 'job')).rejects.toEqual(
      expect.objectContaining<Partial<ParserError>>({ code: 'unsupported-format' }),
    );
  });

  it('destroys PDF.js resources when extraction times out', async () => {
    const destroy = vi.fn(() => Promise.resolve());
    vi.mocked(getResolvedPDFJS).mockResolvedValueOnce({
      getDocument: () => ({ destroy, promise: Promise.resolve({ numPages: 1 }) }),
    } as never);
    vi.mocked(extractText).mockImplementationOnce(() => new Promise(() => undefined));

    await expect(
      parsePdf(createPdf(['Stalled fictional resume']), 'resume', {
        ...DEFAULT_PARSER_CONFIG,
        pdfTimeoutMs: 1,
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<ParserError>>({ code: 'pdf-timeout' }));
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the loading task when document proxy creation times out', async () => {
    const destroy = vi.fn(() => Promise.resolve());
    vi.mocked(getResolvedPDFJS).mockResolvedValueOnce({
      getDocument: () => ({ destroy, promise: new Promise(() => undefined) }),
    } as never);

    await expect(
      parsePdf(createPdf(['Stalled fictional loading task']), 'resume', {
        ...DEFAULT_PARSER_CONFIG,
        pdfTimeoutMs: 1,
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<ParserError>>({ code: 'pdf-timeout' }));
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(extractText).not.toHaveBeenCalled();
  });
});

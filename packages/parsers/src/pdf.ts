import { extractText, getResolvedPDFJS } from 'unpdf';

import {
  ParsedDocumentSchema,
  ParserConfigSchema,
  type ParsedDocument,
  type ParserConfig,
} from '@roleproof/shared';

import { DEFAULT_PARSER_CONFIG } from './config.js';
import { ParserError } from './errors.js';
import { createDocumentId, normalizeDocumentText } from './plaintext.js';

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new ParserError('pdf-timeout', `PDF extraction exceeded ${timeoutMs} milliseconds`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function parsePdf(
  input: Uint8Array,
  kind: 'job' | 'resume',
  config: ParserConfig = DEFAULT_PARSER_CONFIG,
): Promise<ParsedDocument> {
  const validatedConfig = ParserConfigSchema.parse(config);
  if (kind === 'job') {
    throw new ParserError('unsupported-format', 'Phase 1 job documents must be plaintext');
  }
  if (input.byteLength > validatedConfig.maxPdfBytes) {
    throw new ParserError(
      'size-limit',
      `PDF document exceeds the ${validatedConfig.maxPdfBytes}-byte limit`,
    );
  }

  type PdfJsModule = Awaited<ReturnType<typeof getResolvedPDFJS>>;
  let loadingTask: ReturnType<PdfJsModule['getDocument']> | undefined;
  let destroyed = false;
  let timedOut = false;
  const destroyPdf = async (): Promise<void> => {
    if (loadingTask !== undefined && !destroyed) {
      destroyed = true;
      await loadingTask.destroy();
    }
  };
  const parseWork = async (): Promise<ParsedDocument> => {
    try {
      const pdfjs = await getResolvedPDFJS();
      loadingTask = pdfjs.getDocument({
        data: new Uint8Array(input),
        disableFontFace: true,
        maxImageSize: validatedConfig.maxImagePixels,
        useSystemFonts: true,
        verbosity: 0,
      });
      const pdf = await loadingTask.promise;
      if (timedOut) {
        throw new ParserError(
          'pdf-timeout',
          `PDF extraction exceeded ${validatedConfig.pdfTimeoutMs} milliseconds`,
        );
      }
      if (pdf.numPages > validatedConfig.maxPdfPages) {
        throw new ParserError(
          'pdf-page-limit',
          `PDF has ${pdf.numPages} pages; the limit is ${validatedConfig.maxPdfPages}`,
        );
      }
      const extracted = await extractText(pdf, { mergePages: true });
      const rawText = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text;
      const text = normalizeDocumentText(rawText);
      if (text.length === 0) {
        throw new ParserError('empty-document', 'PDF contains no readable text');
      }
      const textBytes = new TextEncoder().encode(text).byteLength;
      if (textBytes > validatedConfig.maxTextBytes) {
        throw new ParserError(
          'size-limit',
          `Extracted PDF text exceeds the ${validatedConfig.maxTextBytes}-byte text limit`,
        );
      }
      const warnings =
        text.length < 40
          ? [
              {
                code: 'pdf-low-text-content' as const,
                message: 'PDF contains very little extractable text.',
              },
            ]
          : [];

      return ParsedDocumentSchema.parse({
        schemaVersion: '1.0',
        id: createDocumentId(kind, text),
        kind,
        format: 'pdf',
        text,
        confidence: warnings.length === 0 ? 1 : 0.5,
        warnings,
      });
    } finally {
      await destroyPdf();
    }
  };

  try {
    return await withTimeout(parseWork(), validatedConfig.pdfTimeoutMs, () => {
      timedOut = true;
      void destroyPdf().catch(() => undefined);
    });
  } catch (error) {
    if (error instanceof ParserError) {
      throw error;
    }
    throw new ParserError('pdf-error', 'PDF could not be parsed safely');
  }
}

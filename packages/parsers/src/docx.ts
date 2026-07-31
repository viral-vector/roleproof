import { extractRawText } from 'mammoth';

import {
  ParsedDocumentSchema,
  ParserConfigSchema,
  type ParsedDocument,
  type ParserConfig,
} from '@roleproof/shared';

import { DEFAULT_PARSER_CONFIG } from './config.js';
import { ParserError } from './errors.js';
import { createDocumentId, normalizeDocumentText } from './plaintext.js';

function toBuffer(input: Uint8Array): Buffer {
  return Buffer.isBuffer(input)
    ? input
    : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}

export async function parseDocx(
  input: Uint8Array,
  kind: 'job' | 'resume',
  config: ParserConfig = DEFAULT_PARSER_CONFIG,
): Promise<ParsedDocument> {
  const validatedConfig = ParserConfigSchema.parse(config);
  if (kind === 'job') {
    throw new ParserError('unsupported-format', 'Phase 1 job documents must be plaintext');
  }
  if (input.byteLength > validatedConfig.maxDocxBytes) {
    throw new ParserError(
      'size-limit',
      `DOCX document exceeds the ${validatedConfig.maxDocxBytes}-byte limit`,
    );
  }

  let rawText: string;
  try {
    const result = await extractRawText({ buffer: toBuffer(input) });
    rawText = result.value;
  } catch {
    throw new ParserError('docx-error', 'DOCX could not be parsed safely');
  }

  const text = normalizeDocumentText(rawText);
  if (text.length === 0) {
    throw new ParserError('empty-document', 'DOCX contains no readable text');
  }
  const textBytes = new TextEncoder().encode(text).byteLength;
  if (textBytes > validatedConfig.maxTextBytes) {
    throw new ParserError(
      'size-limit',
      `Extracted DOCX text exceeds the ${validatedConfig.maxTextBytes}-byte text limit`,
    );
  }
  const warnings =
    text.length < 40
      ? [
          {
            code: 'docx-low-text-content' as const,
            message: 'DOCX contains very little extractable text.',
          },
        ]
      : [];

  return ParsedDocumentSchema.parse({
    schemaVersion: '1.0',
    id: createDocumentId(kind, text),
    kind,
    format: 'docx',
    text,
    confidence: warnings.length === 0 ? 1 : 0.5,
    warnings,
  });
}

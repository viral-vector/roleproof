import { createHash } from 'node:crypto';

import {
  ParsedDocumentSchema,
  ParserConfigSchema,
  type ParsedDocument,
  type ParserConfig,
} from '@roleproof/shared';

import { DEFAULT_PARSER_CONFIG } from './config.js';
import { ParserError } from './errors.js';

function decodeInput(input: string | Uint8Array): { bytes: Uint8Array; text: string } {
  if (typeof input === 'string') {
    return { bytes: new TextEncoder().encode(input), text: input };
  }

  try {
    return {
      bytes: input,
      text: new TextDecoder('utf-8', { fatal: true }).decode(input),
    };
  } catch {
    throw new ParserError('binary-content', 'Document is not valid UTF-8 plaintext');
  }
}

export function normalizeDocumentText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .trim();
}

export function createDocumentId(kind: 'job' | 'resume', text: string): string {
  const hash = createHash('sha256').update(`${kind}\0${text}`, 'utf8').digest('hex');
  return `${kind}-${hash.slice(0, 24)}`;
}

export function parsePlaintext(
  input: string | Uint8Array,
  kind: 'job' | 'resume',
  config: ParserConfig = DEFAULT_PARSER_CONFIG,
): ParsedDocument {
  const validatedConfig = ParserConfigSchema.parse(config);
  const { bytes, text } = decodeInput(input);

  if (bytes.byteLength > validatedConfig.maxTextBytes) {
    throw new ParserError(
      'size-limit',
      `Plaintext document exceeds the ${validatedConfig.maxTextBytes}-byte limit`,
    );
  }
  if (text.includes('\0')) {
    throw new ParserError('binary-content', 'Document contains binary NUL content');
  }

  const normalizedText = normalizeDocumentText(text);
  if (normalizedText.length === 0) {
    throw new ParserError('empty-document', 'Document contains no readable text');
  }

  return ParsedDocumentSchema.parse({
    schemaVersion: '1.0',
    id: createDocumentId(kind, normalizedText),
    kind,
    format: 'plaintext',
    text: normalizedText,
    confidence: 1,
    warnings: [],
  });
}

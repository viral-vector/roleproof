import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import { ParserConfigSchema, type ParsedDocument, type ParserConfig } from '@roleproof/shared';

import { DEFAULT_PARSER_CONFIG } from './config.js';
import { parseDocx } from './docx.js';
import { ParserError } from './errors.js';
import { parsePdf } from './pdf.js';
import { parsePlaintext } from './plaintext.js';

export interface ParsedDocumentFile {
  document: ParsedDocument;
  contentSha256: string;
  originalName: string;
}

export async function parseDocumentFileWithMetadata(
  inputPath: string,
  kind: 'job' | 'resume',
  config: ParserConfig = DEFAULT_PARSER_CONFIG,
): Promise<ParsedDocumentFile> {
  const isPdf = extname(inputPath).toLocaleLowerCase('en-US') === '.pdf';
  const isDocx = extname(inputPath).toLocaleLowerCase('en-US') === '.docx';
  if ((isPdf || isDocx) && kind === 'job') {
    throw new ParserError(
      'unsupported-format',
      `Job input must be a plaintext file: ${inputPath}`,
      inputPath,
    );
  }
  const validatedConfig = ParserConfigSchema.parse(config);

  let fileSize: number;
  try {
    const file = await stat(inputPath);
    if (!file.isFile()) {
      throw new Error('Input path is not a file');
    }
    fileSize = file.size;
  } catch {
    throw new ParserError(
      'file-read',
      `Unable to read ${kind} input at ${inputPath}. Check that the file exists and is readable.`,
      inputPath,
    );
  }

  const byteLimit = isPdf
    ? validatedConfig.maxPdfBytes
    : isDocx
      ? validatedConfig.maxDocxBytes
      : validatedConfig.maxTextBytes;
  if (fileSize > byteLimit) {
    throw new ParserError(
      'size-limit',
      `${kind === 'resume' ? 'Resume' : 'Job'} input exceeds the ${byteLimit}-byte limit. Input: ${inputPath}`,
      inputPath,
    );
  }

  let content: Uint8Array;
  try {
    content = await readFile(inputPath);
  } catch {
    throw new ParserError(
      'file-read',
      `Unable to read ${kind} input at ${inputPath}. Check that the file exists and is readable.`,
      inputPath,
    );
  }

  try {
    const document = isPdf
      ? await parsePdf(content, kind, validatedConfig)
      : isDocx
        ? await parseDocx(content, kind, validatedConfig)
        : parsePlaintext(content, kind, validatedConfig);
    return {
      document,
      contentSha256: createHash('sha256').update(content).digest('hex'),
      originalName: basename(inputPath),
    };
  } catch (error) {
    if (error instanceof ParserError) {
      throw new ParserError(error.code, `${error.message} Input: ${inputPath}`, inputPath);
    }
    throw error;
  }
}

export async function parseDocumentFile(
  inputPath: string,
  kind: 'job' | 'resume',
  config: ParserConfig = DEFAULT_PARSER_CONFIG,
): Promise<ParsedDocument> {
  return (await parseDocumentFileWithMetadata(inputPath, kind, config)).document;
}

export function parsePlaintextBytesWithMetadata(
  input: Uint8Array,
  kind: 'job' | 'resume',
  config: ParserConfig = DEFAULT_PARSER_CONFIG,
): ParsedDocumentFile {
  const validatedConfig = ParserConfigSchema.parse(config);
  const document = parsePlaintext(input, kind, validatedConfig);
  return {
    document,
    contentSha256: createHash('sha256').update(input).digest('hex'),
    originalName: '(stdin)',
  };
}

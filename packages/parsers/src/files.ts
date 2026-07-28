import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

import { ParserConfigSchema, type ParsedDocument, type ParserConfig } from '@roleproof/shared';

import { DEFAULT_PARSER_CONFIG } from './config.js';
import { ParserError } from './errors.js';
import { parsePdf } from './pdf.js';
import { parsePlaintext } from './plaintext.js';

export async function parseDocumentFile(
  inputPath: string,
  kind: 'job' | 'resume',
  config: ParserConfig = DEFAULT_PARSER_CONFIG,
): Promise<ParsedDocument> {
  const isPdf = extname(inputPath).toLocaleLowerCase('en-US') === '.pdf';
  if (isPdf && kind === 'job') {
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

  const byteLimit = isPdf ? validatedConfig.maxPdfBytes : validatedConfig.maxTextBytes;
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
    return isPdf
      ? await parsePdf(content, kind, validatedConfig)
      : parsePlaintext(content, kind, validatedConfig);
  } catch (error) {
    if (error instanceof ParserError) {
      throw new ParserError(error.code, `${error.message} Input: ${inputPath}`, inputPath);
    }
    throw error;
  }
}

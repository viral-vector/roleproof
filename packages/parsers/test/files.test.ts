import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

import {
  DEFAULT_PARSER_CONFIG,
  ParserError,
  parseDocumentFile,
  parseDocumentFileWithMetadata,
} from '../src/index.js';

describe('parseDocumentFile', () => {
  let directory: string;

  beforeEach(async () => {
    vi.mocked(readFile).mockClear();
    directory = await mkdtemp(join(tmpdir(), 'roleproof parser-'));
  });

  afterEach(async () => {
    await rm(directory, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 });
  });

  it('reads a plaintext path containing spaces', async () => {
    const path = join(directory, 'fictional resume.txt');
    await writeFile(path, 'Skills: TypeScript\n', 'utf8');

    const parsed = await parseDocumentFile(path, 'resume');

    expect(parsed.text).toBe('Skills: TypeScript');
    expect(parsed.format).toBe('plaintext');
  });

  it('delegates without changing its ParsedDocument output', async () => {
    const path = join(directory, 'legacy-resume.txt');
    await writeFile(path, 'Skills: TypeScript\r\n', 'utf8');

    const parsed = await parseDocumentFile(path, 'resume');
    const imported = await parseDocumentFileWithMetadata(path, 'resume');

    expect(parsed).toEqual(imported.document);
  });

  it('reports the missing path without document contents', async () => {
    const path = join(directory, 'missing.txt');

    await expect(parseDocumentFile(path, 'resume')).rejects.toEqual(
      expect.objectContaining<Partial<ParserError>>({
        code: 'file-read',
        inputPath: path,
      }),
    );
  });

  it('rejects PDF job paths before extraction', async () => {
    const path = join(directory, 'job.pdf');
    await writeFile(path, '%PDF-invalid', 'utf8');

    await expect(parseDocumentFile(path, 'job')).rejects.toEqual(
      expect.objectContaining<Partial<ParserError>>({
        code: 'unsupported-format',
        inputPath: path,
      }),
    );
  });

  it('rejects an oversized file before loading it into memory', async () => {
    const path = join(directory, 'oversized-resume.txt');
    await writeFile(path, 'Skills: TypeScript\n', 'utf8');

    await expect(
      parseDocumentFile(path, 'resume', { ...DEFAULT_PARSER_CONFIG, maxTextBytes: 10 }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ParserError>>({
        code: 'size-limit',
        inputPath: path,
      }),
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  it('validates parser limits before reading a file', async () => {
    const path = join(directory, 'resume.txt');
    await writeFile(path, 'Skills: TypeScript\n', 'utf8');

    await expect(
      parseDocumentFile(path, 'resume', {
        ...DEFAULT_PARSER_CONFIG,
        maxTextBytes: Number.NaN,
      }),
    ).rejects.toEqual(expect.objectContaining({ name: 'ZodError' }));
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe('parseDocumentFileWithMetadata', () => {
  let directory: string;

  beforeEach(async () => {
    vi.mocked(readFile).mockClear();
    directory = await mkdtemp(join(tmpdir(), 'roleproof parser metadata-'));
  });

  afterEach(async () => {
    await rm(directory, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 });
  });

  it('returns the exact source-byte SHA-256 and basename without retaining the source path', async () => {
    const path = join(directory, 'private', 'fictional resume.txt');
    await mkdir(join(directory, 'private'));
    await writeFile(path, 'Skills: TypeScript\r\n', 'utf8');

    const imported = await parseDocumentFileWithMetadata(path, 'resume');

    expect(imported.document).toMatchObject({ text: 'Skills: TypeScript', format: 'plaintext' });
    expect(imported.contentSha256).toBe(
      'f8de07670ab30ad56eff58e48971ae289dfbd7671481033b6dcc7061b2313605',
    );
    expect(imported.originalName).toBe('fictional resume.txt');
    expect(JSON.stringify(imported)).not.toContain(directory);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('preserves bounded-read size and file-read errors', async () => {
    const oversizedPath = join(directory, 'oversized.txt');
    const missingPath = join(directory, 'missing.txt');
    await writeFile(oversizedPath, 'Skills: TypeScript\n', 'utf8');

    await expect(
      parseDocumentFileWithMetadata(oversizedPath, 'resume', {
        ...DEFAULT_PARSER_CONFIG,
        maxTextBytes: 10,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ParserError>>({
        code: 'size-limit',
        inputPath: oversizedPath,
      }),
    );
    await expect(parseDocumentFileWithMetadata(missingPath, 'resume')).rejects.toEqual(
      expect.objectContaining<Partial<ParserError>>({
        code: 'file-read',
        inputPath: missingPath,
      }),
    );
    expect(readFile).not.toHaveBeenCalled();
  });
});

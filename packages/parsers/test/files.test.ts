import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

import { DEFAULT_PARSER_CONFIG, ParserError, parseDocumentFile } from '../src/index.js';

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

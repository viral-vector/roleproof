import { describe, expect, it } from 'vitest';

import { DEFAULT_PARSER_CONFIG, ParserError, parsePlaintext } from '../src/index.js';

function captureParserError(action: () => void): ParserError {
  try {
    action();
  } catch (error) {
    if (error instanceof ParserError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected parser error');
}

describe('parsePlaintext', () => {
  it('normalizes a BOM and line endings and produces a stable content ID', () => {
    const first = parsePlaintext('\uFEFFSkills:\r\nTypeScript\r\nNode.js\r', 'resume');
    const second = parsePlaintext('Skills:\nTypeScript\nNode.js\n', 'resume');

    expect(first.text).toBe('Skills:\nTypeScript\nNode.js');
    expect(first.id).toBe(second.id);
    expect(first).toEqual(
      expect.objectContaining({
        schemaVersion: '1.0',
        kind: 'resume',
        format: 'plaintext',
        confidence: 1,
        warnings: [],
      }),
    );
  });

  it('rejects blank input as a parsing error', () => {
    expect(captureParserError(() => parsePlaintext(' \r\n\t', 'job')).code).toBe('empty-document');
  });

  it('rejects binary-like NUL content and malformed UTF-8', () => {
    expect(captureParserError(() => parsePlaintext('TypeScript\0hidden', 'resume')).code).toBe(
      'binary-content',
    );
    expect(
      captureParserError(() => parsePlaintext(new Uint8Array([0xff, 0xfe, 0xfd]), 'resume')).code,
    ).toBe('binary-content');
  });

  it('rejects input over the configured byte limit', () => {
    expect(
      captureParserError(() =>
        parsePlaintext('TypeScript', 'resume', {
          ...DEFAULT_PARSER_CONFIG,
          maxTextBytes: 4,
        }),
      ).code,
    ).toBe('size-limit');
  });
});

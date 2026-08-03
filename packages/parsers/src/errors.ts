export type ParserErrorCode =
  | 'binary-content'
  | 'docx-error'
  | 'empty-document'
  | 'empty-extraction'
  | 'content-type-unsupported'
  | 'fetch-failed'
  | 'fetch-redirect-limit'
  | 'fetch-size-limit'
  | 'fetch-timeout'
  | 'file-read'
  | 'pdf-error'
  | 'pdf-page-limit'
  | 'pdf-timeout'
  | 'removed-unavailable'
  | 'size-limit'
  | 'url-invalid'
  | 'url-unsafe-destination'
  | 'url-unsupported-protocol'
  | 'unsupported-format';

export class ParserError extends Error {
  readonly code: ParserErrorCode;
  readonly inputPath?: string;

  constructor(code: ParserErrorCode, message: string, inputPath?: string) {
    super(message);
    this.name = 'ParserError';
    this.code = code;
    if (inputPath !== undefined) {
      this.inputPath = inputPath;
    }
  }
}

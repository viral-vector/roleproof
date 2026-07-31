export type ParserErrorCode =
  | 'binary-content'
  | 'docx-error'
  | 'empty-document'
  | 'file-read'
  | 'pdf-error'
  | 'pdf-page-limit'
  | 'pdf-timeout'
  | 'size-limit'
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

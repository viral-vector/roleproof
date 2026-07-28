export class CliError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number, message: string) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

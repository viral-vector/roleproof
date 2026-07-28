import { createRequire } from 'node:module';

import { Command, CommanderError } from 'commander';

interface PackageMetadata {
  version: string;
}

export interface CliOutput {
  writeOut(message: string): void;
  writeErr(message: string): void;
}

const require = createRequire(import.meta.url);
const packageMetadata = require('../package.json') as PackageMetadata;

export function createProgram(output: CliOutput): Command {
  const program = new Command();

  program
    .name('roleproof')
    .description('Local-first, evidence-based job-fit analysis')
    .version(packageMetadata.version)
    .showHelpAfterError('Run roleproof --help for usage.')
    .configureOutput({
      writeErr: (message) => output.writeErr(message),
      writeOut: (message) => output.writeOut(message),
    })
    .exitOverride((error) => {
      if (error.exitCode === 0) {
        throw error;
      }

      throw new CommanderError(2, error.code, error.message);
    });

  return program;
}

export async function runCli(args: string[], output: CliOutput): Promise<number> {
  try {
    await createProgram(output).parseAsync(args, { from: 'user' });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }

    throw error;
  }
}

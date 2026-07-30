import { createRequire } from 'node:module';

import { Command, CommanderError } from 'commander';

import { registerAnalyzeCommand } from './commands/analyze.js';
import { registerProviderCommands } from './commands/providers.js';
import { registerServeCommand } from './commands/serve.js';
import { registerStorageCommands } from './commands/storage.js';
import { CliError } from './errors.js';

interface PackageMetadata {
  version: string;
}

export interface CliOutput {
  writeOut(message: string): void;
  writeErr(message: string): void;
}

export interface CliState {
  exitCode: number;
}

const require = createRequire(import.meta.url);
const packageMetadata = require('../package.json') as PackageMetadata;

export function createProgram(output: CliOutput, state: CliState = { exitCode: 0 }): Command {
  const program = new Command();

  program
    .name('roleproof')
    .description('Local-first, evidence-based job-fit analysis')
    .version(packageMetadata.version)
    .option('--db <absolute-sqlite-path>', 'Absolute path to the RoleProof SQLite database')
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

  registerAnalyzeCommand(program, output, state);
  registerProviderCommands(program, output, state);
  registerServeCommand(program, output);
  registerStorageCommands(program, output);

  return program;
}

export async function runCli(args: string[], output: CliOutput): Promise<number> {
  const state: CliState = { exitCode: 0 };
  try {
    await createProgram(output, state).parseAsync(args, { from: 'user' });
    return state.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    if (error instanceof CliError) {
      output.writeErr(`roleproof: ${error.message}\n`);
      return error.exitCode;
    }

    throw error;
  }
}

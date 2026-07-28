import { analyzeDeterministic } from '@roleproof/core';
import { ParserError, parseDocumentFile } from '@roleproof/parsers';
import { renderJson, renderMarkdown } from '@roleproof/reporters';
import { CandidateContextSchema } from '@roleproof/shared';
import type { Command } from 'commander';

import { CliError } from '../errors.js';
import { writeAnalysisOutput } from '../output.js';
import type { CliOutput, CliState } from '../program.js';
import { AnalyzeOptionsSchema } from './analyze-options.js';

export function registerAnalyzeCommand(program: Command, output: CliOutput, state: CliState): void {
  program
    .command('analyze')
    .description('Analyze a local resume against a local plaintext job description')
    .requiredOption('--resume <path>', 'Path to a plaintext or PDF resume')
    .requiredOption('--job <path>', 'Path to a plaintext job description')
    .option('--format <format>', 'Output format: markdown, json, or both', 'markdown')
    .option('--out <directory>', 'Write report files to this directory')
    .option('--stdout', 'Write a single selected format to stdout', false)
    .option('--no-ai', 'Use deterministic analysis without AI')
    .option('--no-store', 'Do not persist analysis content')
    .option('--target-salary-min <number>', 'Candidate minimum annual salary')
    .option('--target-salary-max <number>', 'Candidate maximum annual salary')
    .option('--location <value>', 'Candidate preferred location')
    .option('--remote-preference <value>', 'remote, hybrid, onsite, or any')
    .action(async (rawOptions: unknown) => {
      const parsedOptions = AnalyzeOptionsSchema.safeParse(rawOptions);
      if (!parsedOptions.success) {
        throw new CliError(2, parsedOptions.error.issues[0]?.message ?? 'Invalid analyze options.');
      }
      const options = parsedOptions.data;

      try {
        const [resume, job] = await Promise.all([
          parseDocumentFile(options.resume, 'resume'),
          parseDocumentFile(options.job, 'job'),
        ]);
        const candidateContext = CandidateContextSchema.parse({
          preferredLocations: options.location === undefined ? [] : [options.location],
          ...(options.remotePreference === undefined
            ? {}
            : { remotePreference: options.remotePreference }),
          ...(options.targetSalaryMin === undefined
            ? {}
            : { targetSalaryMin: options.targetSalaryMin }),
          ...(options.targetSalaryMax === undefined
            ? {}
            : { targetSalaryMax: options.targetSalaryMax }),
          clearances: [],
          licenses: [],
          education: [],
          certifications: [],
        });
        const analysis = analyzeDeterministic({ resume, job, candidateContext });
        const reports = {
          json: renderJson(analysis),
          markdown: renderMarkdown(analysis),
        };
        await writeAnalysisOutput(options, reports, output);
        state.exitCode = analysis.hardBlockers.length > 0 ? 10 : 0;
      } catch (error) {
        if (error instanceof CliError) {
          throw error;
        }
        if (error instanceof ParserError) {
          throw new CliError(3, error.message);
        }
        throw new CliError(1, 'Analysis failed. Verify the inputs and try again.');
      }
    });
}

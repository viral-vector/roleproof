import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { AnalyzeOptions } from './commands/analyze-options.js';
import { CliError } from './errors.js';
import type { CliOutput } from './program.js';

interface RenderedReports {
  json: string;
  markdown: string;
}

export async function writeAnalysisOutput(
  options: AnalyzeOptions,
  reports: RenderedReports,
  output: CliOutput,
): Promise<void> {
  const formats = options.format === 'both' ? (['json', 'markdown'] as const) : [options.format];
  const outputDirectory = options.out ?? (options.format === 'both' ? process.cwd() : undefined);

  if (outputDirectory !== undefined) {
    const resolvedDirectory = resolve(outputDirectory);
    try {
      await mkdir(resolvedDirectory, { recursive: true });
      await Promise.all(
        formats.map(async (format) => {
          const fileName = format === 'json' ? 'roleproof-analysis.json' : 'roleproof-analysis.md';
          await writeFile(resolve(resolvedDirectory, fileName), reports[format], 'utf8');
        }),
      );
    } catch {
      throw new CliError(
        1,
        `Unable to write analysis output in ${resolvedDirectory}. Check directory permissions and try again.`,
      );
    }
  }

  if (options.stdout || outputDirectory === undefined) {
    const format = options.format === 'both' ? undefined : options.format;
    if (format === undefined) {
      throw new CliError(2, 'JSON and Markdown cannot be written together to stdout.');
    }
    output.writeOut(reports[format]);
  }
}

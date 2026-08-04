import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  renderBatchJson,
  renderBatchMarkdown,
  renderJson,
  renderMarkdown,
} from '@roleproof/reporters';
import type { BatchEnvelope } from '@roleproof/shared';

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

export async function writeBatchOutput(
  options: AnalyzeOptions,
  envelope: BatchEnvelope,
  output: CliOutput,
): Promise<void> {
  const formats = options.format === 'both' ? (['json', 'markdown'] as const) : [options.format];
  const outputDirectory = options.out;

  if (outputDirectory !== undefined) {
    const resolvedDirectory = resolve(outputDirectory);
    try {
      await mkdir(resolvedDirectory, { recursive: true });
      await Promise.all([
        ...(formats.includes('json')
          ? [
              writeFile(
                resolve(resolvedDirectory, 'roleproof-batch.json'),
                renderBatchJson(envelope),
                'utf8',
              ),
            ]
          : []),
        ...(formats.includes('markdown')
          ? [
              writeFile(
                resolve(resolvedDirectory, 'roleproof-batch.md'),
                renderBatchMarkdown(envelope),
                'utf8',
              ),
            ]
          : []),
        ...envelope.pairs.flatMap((pair, index) => {
          if (pair.status !== 'completed') return [];
          const base = `roleproof-batch-pair-${index + 1}`;
          return formats.flatMap((format) => [
            writeFile(
              resolve(resolvedDirectory, `${base}.${format === 'json' ? 'json' : 'md'}`),
              format === 'json' ? renderJson(pair.analysis) : renderMarkdown(pair.analysis),
              'utf8',
            ),
          ]);
        }),
      ]);
    } catch {
      throw new CliError(
        1,
        `Unable to write batch output in ${resolvedDirectory}. Check directory permissions and try again.`,
      );
    }
  }

  if (options.stdout || outputDirectory === undefined) {
    const format = options.format === 'both' ? undefined : options.format;
    if (format === undefined) {
      throw new CliError(2, 'JSON and Markdown cannot be written together to stdout.');
    }
    output.writeOut(format === 'json' ? renderBatchJson(envelope) : renderBatchMarkdown(envelope));
  }
}

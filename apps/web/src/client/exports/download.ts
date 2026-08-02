import {
  renderEnhancedJson,
  renderJson,
  renderEnhancedMarkdown,
  renderMarkdown,
} from '@roleproof/reporters';
import type { LocalAnalyzeResponse } from '@roleproof/shared';

export type AnalysisDownloadFormat = 'json' | 'markdown';

export interface AnalysisDownload {
  filename: string;
  mimeType: string;
  content: string;
}

export function orderedExportFormats(
  defaultFormat: AnalysisDownloadFormat | null | undefined,
): Array<AnalysisDownloadFormat> {
  const preferred = defaultFormat ?? 'json';
  return preferred === 'markdown' ? ['markdown', 'json'] : ['json', 'markdown'];
}

export function createAnalysisDownload(
  response: LocalAnalyzeResponse,
  format: AnalysisDownloadFormat,
): AnalysisDownload {
  const analysis = response.analysis;
  const enhancement = response.schemaVersion === '2.0' ? response.aiEnhancement : undefined;
  if (format === 'json') {
    return {
      filename: 'roleproof-analysis.json',
      mimeType: 'application/json;charset=utf-8',
      content:
        enhancement === undefined
          ? renderJson(analysis)
          : renderEnhancedJson(analysis, enhancement),
    };
  }

  return {
    filename: 'roleproof-analysis.md',
    mimeType: 'text/markdown;charset=utf-8',
    content:
      enhancement === undefined
        ? renderMarkdown(analysis)
        : renderEnhancedMarkdown(analysis, enhancement),
  };
}

export function downloadAnalysis(
  response: LocalAnalyzeResponse,
  format: AnalysisDownloadFormat,
): void {
  const download = createAnalysisDownload(response, format);
  const url = URL.createObjectURL(new Blob([download.content], { type: download.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = download.filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

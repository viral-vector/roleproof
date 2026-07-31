import { renderJson, renderMarkdown } from '@roleproof/reporters';
import type { AnalysisResult } from '@roleproof/shared';

export type AnalysisDownloadFormat = 'json' | 'markdown';

export interface AnalysisDownload {
  filename: string;
  mimeType: string;
  content: string;
}

export function createAnalysisDownload(
  analysis: AnalysisResult,
  format: AnalysisDownloadFormat,
): AnalysisDownload {
  if (format === 'json') {
    return {
      filename: 'roleproof-analysis.json',
      mimeType: 'application/json;charset=utf-8',
      content: renderJson(analysis),
    };
  }

  return {
    filename: 'roleproof-analysis.md',
    mimeType: 'text/markdown;charset=utf-8',
    content: renderMarkdown(analysis),
  };
}

export function downloadAnalysis(analysis: AnalysisResult, format: AnalysisDownloadFormat): void {
  const download = createAnalysisDownload(analysis, format);
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

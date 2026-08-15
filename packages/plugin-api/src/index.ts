import { analyzeDeterministic } from '@roleproof/core';
import { parsePlaintext } from '@roleproof/parsers';
import { renderJson, renderMarkdown } from '@roleproof/reporters';
import {
  AnalysisResultSchema,
  CandidateContextSchema,
  type AnalysisResult,
  type CandidateContext,
} from '@roleproof/shared';

export interface AnalyzeTextInput {
  resumeText: string;
  jobText: string;
  candidateContext?: CandidateContext;
}

export interface AnalyzeTextResult {
  analysis: AnalysisResult;
  reports: {
    json: string;
    markdown: string;
  };
}

function defaultCandidateContext(): CandidateContext {
  return CandidateContextSchema.parse({
    preferredLocations: [],
    clearances: [],
    licenses: [],
    education: [],
    certifications: [],
  });
}

export function renderAnalysis(analysis: AnalysisResult, format: 'json' | 'markdown'): string {
  const validated = AnalysisResultSchema.parse(analysis);
  return format === 'json' ? renderJson(validated) : renderMarkdown(validated);
}

export function analyzeText(input: AnalyzeTextInput): AnalyzeTextResult {
  const resume = parsePlaintext(input.resumeText, 'resume');
  const job = parsePlaintext(input.jobText, 'job');
  const analysis = AnalysisResultSchema.parse(
    analyzeDeterministic({
      resume,
      job,
      candidateContext: input.candidateContext ?? defaultCandidateContext(),
    }),
  );

  return {
    analysis,
    reports: {
      json: renderJson(analysis),
      markdown: renderMarkdown(analysis),
    },
  };
}

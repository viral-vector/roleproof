import { describe, expect, it } from 'vitest';

import { AnalysisEnvelopeSchema } from '@roleproof/shared';

import { analyzeText, renderAnalysis } from '../src/index.js';

const resumeText = [
  'Fictional Candidate',
  'Experience: Built TypeScript APIs with Node.js and PostgreSQL.',
].join('\n');

const jobText = ['Required: TypeScript', 'Required: Node.js', 'Required: PostgreSQL'].join('\n');

describe('RoleProof plugin API', () => {
  it('runs deterministic text analysis without storage, providers, or network access', () => {
    const result = analyzeText({ resumeText, jobText });

    expect(result.analysis.metadata.mode).toBe('deterministic');
    expect(result.analysis.matchedRequirements.length).toBeGreaterThan(0);
    expect(result.reports.markdown).toContain('# RoleProof Analysis');
    expect(AnalysisEnvelopeSchema.parse(JSON.parse(result.reports.json)).schemaVersion).toBe('1.0');
  });

  it('renders only validated analysis results for plugins', () => {
    const result = analyzeText({ resumeText, jobText });

    expect(renderAnalysis(result.analysis, 'json')).toBe(result.reports.json);
    expect(renderAnalysis(result.analysis, 'markdown')).toContain('Recommendation:');
  });
});

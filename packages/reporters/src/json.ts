import {
  AnalysisEnvelopeSchema,
  AnalysisResultSchema,
  EnhancedAnalysisEnvelopeSchema,
  type AIEnhancement,
  type AnalysisResult,
} from '@roleproof/shared';

export function renderJson(result: AnalysisResult): string {
  const analysis = AnalysisResultSchema.parse(result);
  const envelope = AnalysisEnvelopeSchema.parse({
    schemaVersion: '1.0',
    analysis,
  });
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function renderEnhancedJson(result: AnalysisResult, enhancement: AIEnhancement): string {
  const envelope = EnhancedAnalysisEnvelopeSchema.parse({
    schemaVersion: '2.0',
    analysis: result,
    aiEnhancement: enhancement,
  });
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

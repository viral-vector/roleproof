import {
  AnalysisEnvelopeSchema,
  AnalysisResultSchema,
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

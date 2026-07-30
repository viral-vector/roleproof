import { LocalAnalyzeRequestSchema, LocalAnalyzeResponseSchema } from '@roleproof/shared';
import type { LocalAnalyzeResponse } from '@roleproof/shared';

export interface LocalHealth {
  schemaVersion: '1.0';
  status: 'ok';
  mode: 'local';
  accountRequired: false;
  cloudRequired: false;
}

export interface AnalyzeLocalInput {
  resumeText: string;
  jobText: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseHealth(value: unknown): LocalHealth {
  if (
    !isRecord(value) ||
    value.schemaVersion !== '1.0' ||
    value.status !== 'ok' ||
    value.mode !== 'local' ||
    value.accountRequired !== false ||
    value.cloudRequired !== false
  ) {
    throw new Error('Health response was invalid.');
  }
  return {
    schemaVersion: value.schemaVersion,
    status: value.status,
    mode: value.mode,
    accountRequired: value.accountRequired,
    cloudRequired: value.cloudRequired,
  };
}

export async function getHealth(fetchImpl: typeof fetch = fetch): Promise<LocalHealth> {
  const response = await fetchImpl('/api/health');
  if (!response.ok) throw new Error('Health check failed.');
  return parseHealth(await response.json());
}

export async function analyzeLocal(
  input: AnalyzeLocalInput,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalAnalyzeResponse> {
  let request: ReturnType<typeof LocalAnalyzeRequestSchema.parse>;
  try {
    request = LocalAnalyzeRequestSchema.parse({
      schemaVersion: '1.0',
      mode: 'deterministic',
      resumeText: input.resumeText,
      jobText: input.jobText,
    });
  } catch {
    throw new Error('Analysis request failed. Check the supplied text.');
  }
  const response = await fetchImpl('/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error('Analysis request failed. Check the supplied text.');
  return LocalAnalyzeResponseSchema.parse(await response.json());
}

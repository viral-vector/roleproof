import {
  LocalAnalyzeRequestSchema,
  LocalAnalyzeResponseSchema,
  LocalAnalyzeStreamEventSchema,
  LocalHistoryListResponseSchema,
  LocalProviderCredentialDeleteResponseSchema,
  LocalProviderCredentialProviderSchema,
  LocalProviderCredentialSaveRequestSchema,
  LocalProviderCredentialStatusResponseSchema,
  LocalProviderModelsQuerySchema,
  LocalProviderModelsResponseSchema,
  LocalResumeParseErrorSchema,
  LocalResumeParseResponseSchema,
  LocalResumeUploadMetadataSchema,
  LocalSettingsPatchSchema,
  LocalSettingsResponseSchema,
  type LocalHistoryListResponse,
  type LocalProviderCredentialDeleteResponse,
  type LocalProviderCredentialProvider,
  type LocalProviderCredentialSaveRequest,
  type LocalProviderCredentialStatusResponse,
  type LocalProviderModelsQuery,
  type LocalProviderModelsResponse,
  type LocalResumeParseErrorCode,
  type LocalSettingsPatch,
  type LocalSettingsResponse,
  type LocalAnalyzeResponse,
  type LocalAnalyzeStreamEvent,
  type LocalResumeParseResponse,
} from '@roleproof/shared';

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
  mode?: 'deterministic' | 'ai-enhanced';
  confirmProviderTransmission?: boolean;
}

export interface AnalyzeLocalStreamCallbacks {
  onEvent?: (event: LocalAnalyzeStreamEvent) => void;
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
  if (input.mode === 'ai-enhanced' && input.confirmProviderTransmission !== true) {
    throw new Error('AI-enhanced analysis requires provider transmission confirmation.');
  }
  let request: ReturnType<typeof LocalAnalyzeRequestSchema.parse>;
  try {
    request = LocalAnalyzeRequestSchema.parse({
      schemaVersion: '1.0',
      mode: input.mode ?? 'deterministic',
      ...(input.mode === 'ai-enhanced'
        ? { confirmProviderTransmission: input.confirmProviderTransmission }
        : {}),
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

async function readAnalyzeStream(
  response: Response,
  onEvent?: (event: LocalAnalyzeStreamEvent) => void,
): Promise<LocalAnalyzeResponse> {
  if (response.body === null) {
    throw new Error('Analysis request failed. Check the supplied text.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: LocalAnalyzeResponse | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf('\n');
      if (line.length === 0) continue;
      const event = LocalAnalyzeStreamEventSchema.parse(JSON.parse(line));
      onEvent?.(event);
      if (event.kind === 'result') result = event.response;
    }
  }

  if (result === null) {
    throw new Error('Analysis request failed. Check the supplied text.');
  }
  return result;
}

export async function analyzeLocalStream(
  input: AnalyzeLocalInput,
  callbacks: AnalyzeLocalStreamCallbacks = {},
  fetchImpl: typeof fetch = fetch,
): Promise<LocalAnalyzeResponse> {
  const response = await fetchImpl('/api/analyze/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify({
      schemaVersion: '1.0',
      mode: input.mode ?? 'deterministic',
      ...(input.mode === 'ai-enhanced'
        ? { confirmProviderTransmission: input.confirmProviderTransmission }
        : {}),
      resumeText: input.resumeText,
      jobText: input.jobText,
    }),
  });
  if (!response.ok) throw new Error('Analysis request failed. Check the supplied text.');
  return readAnalyzeStream(response, callbacks.onEvent);
}

export async function listHistory(
  query?: string | typeof fetch,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalHistoryListResponse> {
  if (typeof query === 'function') {
    fetchImpl = query;
    query = undefined;
  }
  const url =
    query === undefined || query.trim().length === 0
      ? '/api/history'
      : `/api/history?query=${encodeURIComponent(query.trim())}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      response.status === 503
        ? 'History is unavailable. Local storage is not configured.'
        : 'History is unavailable. Check the local server and try again.',
    );
  }
  return LocalHistoryListResponseSchema.parse(await response.json());
}

export async function getHistoryItem(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalAnalyzeResponse> {
  const response = await fetchImpl(`/api/history/${encodeURIComponent(id)}`);
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'History item was not found. It may have been removed.'
        : response.status === 503
          ? 'History is unavailable. Local storage is not configured.'
          : 'History is unavailable. Check the local server and try again.',
    );
  }
  return LocalAnalyzeResponseSchema.parse(await response.json());
}

export async function deleteHistoryItem(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ removed: true }> {
  const response = await fetchImpl(`/api/history/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'History item was not found. It may have been removed.'
        : response.status === 503
          ? 'History is unavailable. Local storage is not configured.'
          : 'History could not be deleted. Check the local server and try again.',
    );
  }
  return { removed: true };
}

export async function getSettings(fetchImpl: typeof fetch = fetch): Promise<LocalSettingsResponse> {
  const response = await fetchImpl('/api/settings');
  if (!response.ok) {
    throw new Error(
      response.status === 503
        ? 'Settings are unavailable. Local storage is not configured.'
        : 'Settings are unavailable. Check the local server and try again.',
    );
  }
  return LocalSettingsResponseSchema.parse(await response.json());
}

export async function updateSettings(
  settings: LocalSettingsPatch,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalSettingsResponse> {
  const parsed = LocalSettingsPatchSchema.safeParse(settings);
  if (!parsed.success) {
    throw new Error(
      'Settings are invalid. Provide a model with a provider, or a base URL for compatible providers.',
    );
  }
  const response = await fetchImpl('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 503
        ? 'Settings are unavailable. Local storage is not configured.'
        : 'Settings could not be saved. Check the local server and try again.',
    );
  }
  return LocalSettingsResponseSchema.parse(await response.json());
}

export async function getProviderCredentialStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<LocalProviderCredentialStatusResponse> {
  const response = await fetchImpl('/api/provider-credentials');
  if (!response.ok) {
    throw new Error('Provider credentials are unavailable. Check the local server and try again.');
  }
  return LocalProviderCredentialStatusResponseSchema.parse(await response.json());
}

export async function saveProviderCredential(
  credential: LocalProviderCredentialSaveRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalProviderCredentialStatusResponse> {
  const parsed = LocalProviderCredentialSaveRequestSchema.safeParse(credential);
  if (!parsed.success) {
    throw new Error('Provider credential is invalid. Enter a non-empty API key.');
  }
  const response = await fetchImpl('/api/provider-credentials', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });
  if (!response.ok) {
    throw new Error(
      'Provider credential could not be saved. Check the local server and try again.',
    );
  }
  return LocalProviderCredentialStatusResponseSchema.parse(await response.json());
}

export async function deleteProviderCredential(
  provider: LocalProviderCredentialProvider,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalProviderCredentialDeleteResponse> {
  const parsed = LocalProviderCredentialProviderSchema.safeParse(provider);
  if (!parsed.success) throw new Error('Provider credential is invalid.');
  const response = await fetchImpl(`/api/provider-credentials/${encodeURIComponent(parsed.data)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(
      'Provider credential could not be removed. Check the local server and try again.',
    );
  }
  return LocalProviderCredentialDeleteResponseSchema.parse(await response.json());
}

export async function listProviderModels(
  query: LocalProviderModelsQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalProviderModelsResponse> {
  const parsed = LocalProviderModelsQuerySchema.safeParse(query);
  if (!parsed.success) throw new Error('Provider model request is invalid.');
  const params = new URLSearchParams({ provider: parsed.data.provider });
  if (parsed.data.destination != null) params.set('destination', parsed.data.destination);
  if (parsed.data.baseUrl != null) params.set('baseUrl', parsed.data.baseUrl);
  if (parsed.data.model != null) params.set('model', parsed.data.model);
  const response = await fetchImpl(`/api/provider-models?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Provider models are unavailable. Check provider settings and try again.');
  }
  return LocalProviderModelsResponseSchema.parse(await response.json());
}

const GENERIC_RESUME_PARSE_ERROR =
  'Resume file could not be parsed. Check that the file is a valid TXT, PDF, or DOCX and try again.';

const RESUME_PARSE_ERROR_MESSAGES: Record<LocalResumeParseErrorCode, string> = {
  'binary-content': 'The file does not look like a plaintext document.',
  'docx-error':
    'The DOCX file could not be read. Re-save it from Word, Google Docs, or LibreOffice and try again.',
  'empty-document':
    'No readable text was found in the file. Scanned or image-only files are not supported; re-save as a text-based document.',
  'pdf-error': 'The PDF file could not be read. Re-save it as a text-based PDF and try again.',
  'pdf-page-limit': 'The PDF exceeds the local page limit for parsing.',
  'pdf-timeout': 'The PDF took too long to extract. Try a smaller file.',
  'size-limit': 'The file exceeds the local parser size limit.',
};

async function readResumeParseError(response: Response): Promise<string> {
  try {
    const body = LocalResumeParseErrorSchema.safeParse(await response.json());
    if (!body.success || body.data.code === undefined) return GENERIC_RESUME_PARSE_ERROR;
    return RESUME_PARSE_ERROR_MESSAGES[body.data.code];
  } catch {
    return GENERIC_RESUME_PARSE_ERROR;
  }
}

export async function parseResumeFile(
  file: File,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalResumeParseResponse> {
  const lowerName = file.name.toLocaleLowerCase('en-US');
  const format = lowerName.endsWith('.pdf')
    ? ('pdf' as const)
    : lowerName.endsWith('.docx')
      ? ('docx' as const)
      : lowerName.endsWith('.txt')
        ? ('plaintext' as const)
        : null;
  if (format === null) throw new Error('Resume file must be plaintext, PDF, or DOCX.');

  const metadata = LocalResumeUploadMetadataSchema.safeParse({
    fileName: file.name,
    format,
    byteLength: file.size,
  });
  if (!metadata.success) throw new Error('Resume file is empty or exceeds the parser size limit.');

  const body = new FormData();
  body.append('resume', file);
  const response = await fetchImpl('/api/resume/parse', { method: 'POST', body });
  if (response.status === 404) {
    throw new Error('Local server is out of date. Restart RoleProof and try again.');
  }
  if (!response.ok) throw new Error(await readResumeParseError(response));
  try {
    return LocalResumeParseResponseSchema.parse(await response.json());
  } catch {
    throw new Error(GENERIC_RESUME_PARSE_ERROR);
  }
}

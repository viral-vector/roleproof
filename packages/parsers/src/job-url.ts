import { createHash } from 'node:crypto';

import {
  JobRetrievalMetadataSchema,
  ParserConfigSchema,
  type ParserConfig,
  type JobRetrievalMetadata,
  type ParsedDocument,
} from '@roleproof/shared';

import { DEFAULT_PARSER_CONFIG } from './config.js';
import { extractHtmlText, extractJobPageText } from './html.js';
import { ParserError } from './errors.js';
import { classifyJobSource } from './job-source.js';
import { parsePlaintext } from './plaintext.js';

export interface JobUrlResult {
  document: ParsedDocument;
  contentSha256: string;
  source: JobRetrievalMetadata;
}

interface FetchResult {
  url: string;
  status: number;
  contentType: string | undefined;
  bytes: Uint8Array;
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isAllowedProtocol(url: URL): boolean {
  return url.protocol === 'https:' || url.protocol === 'http:';
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    parts.some((part, index) => !/^\d{1,3}$/u.test(hostname.split('.')[index] ?? '') || part > 255)
  ) {
    return false;
  }
  const [first = 0, second = 0] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isUnsafeHostname(value: string): boolean {
  const hostname = value
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
    .toLocaleLowerCase('en-US');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata.google.internal' ||
    isPrivateIpv4(hostname)
  ) {
    return true;
  }
  if (!hostname.includes(':')) return false;
  const normalized = hostname.replace(/^0+(?=[\da-f])/gu, '');
  return (
    normalized === '::' ||
    normalized === '::1' ||
    /^f[cd]/u.test(normalized) ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.')
  );
}

function validateFetchUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ParserError('url-invalid', `Job URL is invalid: ${value}`);
  }
  if (!isAllowedProtocol(parsed)) {
    throw new ParserError(
      'url-unsupported-protocol',
      `Unsupported job URL protocol: ${parsed.protocol}`,
    );
  }
  if (
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    isUnsafeHostname(parsed.hostname)
  ) {
    throw new ParserError('url-unsafe-destination', 'Job URL destination is not allowed.');
  }
  return parsed;
}

function isHtmlContentType(value: string | undefined): boolean {
  if (value === undefined) return true;
  const normalized = value.toLocaleLowerCase('en-US');
  return (
    normalized.includes('text/html') ||
    normalized.includes('application/xhtml+xml') ||
    normalized.startsWith('text/')
  );
}

function timeoutError(timeoutMs: number): ParserError {
  return new ParserError('fetch-timeout', `Job fetch timed out after ${timeoutMs}ms.`);
}

function waitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  if (signal.aborted) return Promise.reject(timeoutError(timeoutMs));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(timeoutError(timeoutMs));
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Uint8Array> {
  if (response.body === null) {
    const body = new Uint8Array(await waitWithSignal(response.arrayBuffer(), signal, timeoutMs));
    if (body.byteLength > maxBytes) {
      throw new ParserError('fetch-size-limit', `Job page exceeds the ${maxBytes}-byte limit.`);
    }
    return body;
  }

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const result = await waitWithSignal(reader.read(), signal, timeoutMs);
      if (result.done) break;
      const value = result.value;
      if (total + value.byteLength > maxBytes) {
        throw new ParserError('fetch-size-limit', `Job page exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchOnce(
  requestUrl: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetchImpl(requestUrl, {
      redirect: 'manual',
      signal,
    });
  } catch (error) {
    if (signal.aborted || (error as { name?: string }).name === 'AbortError') {
      throw timeoutError(timeoutMs);
    }
    throw new ParserError('fetch-failed', `Unable to fetch job URL: ${requestUrl}`);
  }
}

async function fetchBounded(
  inputUrl: string,
  config: ParserConfig,
  fetchImpl: typeof fetch,
): Promise<FetchResult> {
  const parsed = validateFetchUrl(inputUrl);
  let currentUrl = parsed.toString();
  let redirects = 0;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.urlTimeoutMs);

  try {
    for (;;) {
      validateFetchUrl(currentUrl);
      const response = await fetchOnce(
        currentUrl,
        fetchImpl,
        controller.signal,
        config.urlTimeoutMs,
      );
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location === null) {
          throw new ParserError(
            'fetch-failed',
            `Redirect from ${currentUrl} was missing a location header.`,
          );
        }
        redirects += 1;
        if (redirects > config.maxUrlRedirects) {
          throw new ParserError(
            'fetch-redirect-limit',
            `Job URL exceeded the ${config.maxUrlRedirects}-redirect limit.`,
          );
        }
        currentUrl = validateFetchUrl(new URL(location, currentUrl).toString()).toString();
        continue;
      }

      if (response.status === 404 || response.status === 410) {
        throw new ParserError(
          'removed-unavailable',
          `The job page appears to be removed or unavailable: ${currentUrl}`,
        );
      }
      if (response.status < 200 || response.status >= 300) {
        throw new ParserError(
          'fetch-failed',
          `Job URL returned HTTP ${response.status}: ${currentUrl}`,
        );
      }

      const contentType = response.headers.get('content-type') ?? undefined;
      if (!isHtmlContentType(contentType)) {
        throw new ParserError(
          'content-type-unsupported',
          `Unsupported job content type: ${contentType ?? 'unknown'}`,
        );
      }

      const bytes = await readBoundedResponseBody(
        response,
        config.maxUrlBytes,
        controller.signal,
        config.urlTimeoutMs,
      );
      return { url: currentUrl, status: response.status, contentType, bytes };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isLikelyBlockedPage(text: string): boolean {
  return /\b(?:access denied|verify you are human|captcha|sign in to continue|just a moment)\b/iu.test(
    text,
  );
}

export async function parseJobUrlWithMetadata(
  url: string,
  config: Partial<ParserConfig> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<JobUrlResult> {
  const validatedConfig = ParserConfigSchema.parse({
    ...DEFAULT_PARSER_CONFIG,
    ...config,
  });
  const fetched = await fetchBounded(url, validatedConfig, fetchImpl);
  const rawText = new TextDecoder('utf-8', { fatal: false }).decode(fetched.bytes);
  const contentText = rawText.includes('<') ? extractJobPageText(rawText, fetched.url) : rawText;
  const normalizedText = normalizeExtractedText(contentText);

  if (normalizedText.length === 0) {
    throw new ParserError(
      'empty-extraction',
      'The fetched job page did not contain readable text.',
    );
  }

  const sourceText = rawText.includes('<') ? extractHtmlText(rawText) : normalizedText;
  if (isLikelyBlockedPage(sourceText)) {
    throw new ParserError('fetch-failed', 'The job page appears to be blocked or require sign-in.');
  }
  const source = classifyJobSource(url, fetched.url, sourceText, fetched.status);
  if (source.removedOrUnavailable) {
    throw new ParserError(
      'removed-unavailable',
      'The job page appears to be removed or unavailable.',
    );
  }
  const warnings = [...source.warnings];
  if (
    fetched.contentType !== undefined &&
    !fetched.contentType.toLocaleLowerCase('en-US').includes('html')
  ) {
    warnings.push({
      code: 'non-html-content',
      message: 'The fetched job page did not advertise HTML content.',
    });
  }

  const metadata = JobRetrievalMetadataSchema.parse({
    ...source,
    ...(fetched.contentType === undefined ? {} : { contentType: fetched.contentType }),
    warnings,
  });

  const document = parsePlaintext(normalizedText, 'job', validatedConfig);
  return {
    document,
    contentSha256: sha256(fetched.bytes),
    source: metadata,
  };
}

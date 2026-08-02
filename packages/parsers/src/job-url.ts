import { createHash } from 'node:crypto';

import {
  JobRetrievalMetadataSchema,
  ParserConfigSchema,
  type ParserConfig,
  type JobRetrievalMetadata,
  type ParsedDocument,
} from '@roleproof/shared';

import { DEFAULT_PARSER_CONFIG } from './config.js';
import { extractHtmlText } from './html.js';
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

function isHtmlContentType(value: string | undefined): boolean {
  if (value === undefined) return true;
  const normalized = value.toLocaleLowerCase('en-US');
  return (
    normalized.includes('text/html') ||
    normalized.includes('application/xhtml+xml') ||
    normalized.startsWith('text/')
  );
}

async function readBoundedResponseBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (response.body === null) {
    const body = new Uint8Array(await response.arrayBuffer());
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
      const result = await reader.read();
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
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(requestUrl, {
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      throw new ParserError('fetch-timeout', `Job fetch timed out after ${timeoutMs}ms.`);
    }
    throw new ParserError('fetch-failed', `Unable to fetch job URL: ${requestUrl}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBounded(
  inputUrl: string,
  config: ParserConfig,
  fetchImpl: typeof fetch,
): Promise<FetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new ParserError('url-invalid', `Job URL is invalid: ${inputUrl}`);
  }
  if (!isAllowedProtocol(parsed)) {
    throw new ParserError(
      'url-unsupported-protocol',
      `Unsupported job URL protocol: ${parsed.protocol}`,
    );
  }

  let currentUrl = parsed.toString();
  let redirects = 0;

  for (;;) {
    const response = await fetchOnce(currentUrl, fetchImpl, config.urlTimeoutMs);
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
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    const contentType = response.headers.get('content-type') ?? undefined;
    if (!isHtmlContentType(contentType)) {
      throw new ParserError(
        'content-type-unsupported',
        `Unsupported job content type: ${contentType ?? 'unknown'}`,
      );
    }

    if (response.status === 404 || response.status === 410) {
      throw new ParserError(
        'removed-unavailable',
        `The job page appears to be removed or unavailable: ${currentUrl}`,
      );
    }

    const bytes = await readBoundedResponseBody(response, config.maxUrlBytes);
    return { url: currentUrl, status: response.status, contentType, bytes };
  }
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
  const contentText = rawText.includes('<') ? extractHtmlText(rawText) : rawText;
  const normalizedText = normalizeExtractedText(contentText);

  if (normalizedText.length === 0) {
    throw new ParserError(
      'empty-extraction',
      'The fetched job page did not contain readable text.',
    );
  }

  const source = classifyJobSource(url, fetched.url, normalizedText, fetched.status);
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
    warnings,
  });

  const document = parsePlaintext(normalizedText, 'job', validatedConfig);
  return {
    document,
    contentSha256: sha256(fetched.bytes),
    source: metadata,
  };
}

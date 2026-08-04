import {
  JobRetrievalMetadataSchema,
  type AtsProvider,
  type JobRetrievalMetadata,
  type JobSourceClassification,
} from '@roleproof/shared';

import { ParserError } from './errors.js';

const AGGREGATOR_HOSTS = [
  'indeed.com',
  'glassdoor.com',
  'linkedin.com',
  'ziprecruiter.com',
  'monster.com',
  'dice.com',
  'careerbuilder.com',
  'simplyhired.com',
  'talent.com',
  'builtin.com',
] as const;

const RECRUITER_HOSTS = [
  'roberthalf.com',
  'randstad.com',
  'adecco.com',
  'kforce.com',
  'teksystems.com',
  'manpowergroup.com',
  'kellyservices.com',
] as const;

const ATS_HOSTS = [
  { provider: 'greenhouse', hosts: ['greenhouse.io'] },
  { provider: 'lever', hosts: ['lever.co'] },
  { provider: 'workday', hosts: ['workday.com', 'myworkdayjobs.com', 'workdayjobs.com'] },
  { provider: 'ashby', hosts: ['ashbyhq.com'] },
  { provider: 'icims', hosts: ['icims.com'] },
  { provider: 'paylocity', hosts: ['paylocity.com'] },
  { provider: 'rippling', hosts: ['rippling.com'] },
  { provider: 'jazzhr', hosts: ['jazzhr.com', 'jazz.co'] },
  { provider: 'smartrecruiters', hosts: ['smartrecruiters.com'] },
] as const;

function hostnameFor(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    throw new ParserError('url-invalid', `Job URL is invalid: ${url}`);
  }
}

function matchesHost(hostname: string, hosts: readonly string[]): boolean {
  return hosts.some((candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`));
}

function detectAtsProvider(hostname: string): AtsProvider {
  for (const entry of ATS_HOSTS) {
    if (matchesHost(hostname, entry.hosts)) return entry.provider;
  }
  return 'unknown';
}

function isAggregator(hostname: string): boolean {
  return matchesHost(hostname, AGGREGATOR_HOSTS);
}

function isRecruiter(hostname: string): boolean {
  return matchesHost(hostname, RECRUITER_HOSTS);
}

function detectRemovedSignals(text: string): boolean {
  const normalized = text.toLocaleLowerCase('en-US');
  return [
    'this job posting has been removed',
    'this position has been removed',
    'no longer available',
    'no longer accepting applications',
    'position has been filled',
    'job has expired',
    'page not found',
    'not found',
  ].some((phrase) => normalized.includes(phrase));
}

export function classifyJobSource(
  url: string,
  finalUrl: string | undefined,
  contentText: string,
  statusCode: number | undefined,
): JobRetrievalMetadata {
  const sourceUrl = finalUrl ?? url;
  const hostname = hostnameFor(sourceUrl);
  const atsProvider = detectAtsProvider(hostname);
  const removedOrUnavailable =
    statusCode === 404 || statusCode === 410 || detectRemovedSignals(contentText);
  const sourceClassification: JobSourceClassification = removedOrUnavailable
    ? 'removed-unavailable'
    : atsProvider !== 'unknown'
      ? 'official-ats'
      : isAggregator(hostname)
        ? 'aggregator'
        : isRecruiter(hostname)
          ? 'recruiter'
          : 'unknown';

  const warnings = [];
  if (removedOrUnavailable) {
    warnings.push({
      code: 'removed-page',
      message: 'The page appears to be removed or unavailable.',
    });
  }
  if (sourceClassification === 'unknown') {
    warnings.push({
      code: 'low-text-content',
      message: 'The source could not be verified as an employer, recruiter, aggregator, or ATS.',
    });
  }

  return JobRetrievalMetadataSchema.parse({
    schemaVersion: '1.0',
    url,
    ...(finalUrl === undefined ? {} : { finalUrl }),
    retrievedAt: new Date().toISOString(),
    ...(statusCode === undefined ? {} : { statusCode }),
    sourceClassification,
    atsProvider,
    removedOrUnavailable,
    confidence: removedOrUnavailable
      ? 0.95
      : sourceClassification === 'official-ats'
        ? 0.95
        : sourceClassification === 'unknown'
          ? 0.5
          : 0.6,
    warnings,
  });
}

export function validateJobSourceMetadata(metadata: JobRetrievalMetadata): JobRetrievalMetadata {
  return JobRetrievalMetadataSchema.parse(metadata);
}

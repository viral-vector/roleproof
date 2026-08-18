import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  analyzeDeterministic,
  analyzeDeterministicWithEvidence,
  buildEvidenceReferences,
  DEFAULT_NORMALIZATION_DATA,
  extractCareerEvidence,
  extractJobRequirements,
  profileFactEvidenceIds,
} from '@roleproof/core';
import {
  ParserError,
  parseDocumentFileWithMetadata,
  parseJobUrlWithMetadata,
  parsePlaintextBytesWithMetadata,
  type ParsedDocumentFile,
} from '@roleproof/parsers';
import {
  buildProviderInputs,
  enhanceAnalysisWithFallback,
  providerConfigFingerprint,
  type AIProvider,
} from '@roleproof/providers';
import {
  renderEnhancedJson,
  renderEnhancedMarkdown,
  renderBatchJson,
  renderJson,
  renderMarkdown,
} from '@roleproof/reporters';
import {
  closeStorage,
  createRoleProofRepositories,
  DEFAULT_PROFILE_ID,
  openStorage,
  StorageError,
  type RoleProofRepositories,
  type StorageDatabase,
} from '@roleproof/storage';
import {
  AnalysisResultSchema,
  BatchEnvelopeSchema,
  BatchManifestSchema,
  CandidateContextSchema,
  DEFAULT_BATCH_CONFIG,
  WebhookDeliveryResultSchema,
  type AnalysisResult,
  type BatchManifest,
  type CandidateProfile,
  type CareerEvidence,
  type JobRequirement,
  type JobRetrievalMetadata,
  type ParsedDocument,
  type ProviderConfig,
  type StoredDocument,
} from '@roleproof/shared';
import type { Command } from 'commander';

import { CliError } from '../errors.js';
import { writeAnalysisOutput, writeBatchOutput } from '../output.js';
import type { CliOutput, CliState } from '../program.js';
import { AnalyzeOptionsSchema, type AnalyzeOptions } from './analyze-options.js';
import { buildProviderConfig, createConfiguredProvider } from './provider-config.js';

type AnalysisLike = AnalysisResult & {
  scoreContributions: NonNullable<AnalysisResult['scoreContributions']>;
};

type JobInput = {
  document: ParsedDocument;
  contentSha256: string;
  originalName?: string;
  source?: JobRetrievalMetadata | undefined;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${sha256(parts.join('\0')).slice(0, 24)}`;
}

function databasePath(command: Command): string | undefined {
  const options: unknown = command.optsWithGlobals();
  if (typeof options !== 'object' || options === null || !('db' in options)) return undefined;
  return typeof options.db === 'string' ? options.db : undefined;
}

function candidateContext(options: AnalyzeOptions, profile?: CandidateProfile) {
  return CandidateContextSchema.parse({
    preferredLocations:
      options.location === undefined ? (profile?.preferredLocations ?? []) : [options.location],
    ...((options.remotePreference ?? profile?.remotePreference) === undefined
      ? {}
      : { remotePreference: options.remotePreference ?? profile?.remotePreference }),
    ...((options.targetSalaryMin ?? profile?.targetSalaryMin) === undefined
      ? {}
      : { targetSalaryMin: options.targetSalaryMin ?? profile?.targetSalaryMin }),
    ...((options.targetSalaryMax ?? profile?.targetSalaryMax) === undefined
      ? {}
      : { targetSalaryMax: options.targetSalaryMax ?? profile?.targetSalaryMax }),
    ...(profile?.workAuthorization === undefined
      ? {}
      : { workAuthorization: profile.workAuthorization }),
    clearances: [],
    licenses: [],
    education: [],
    certifications: [],
  });
}

function parsedResume(document: StoredDocument): ParsedDocument {
  return {
    schemaVersion: '1.0',
    id: document.id,
    kind: 'resume',
    format: document.format,
    text: document.text,
    confidence: document.confidence,
    warnings: document.warnings,
  };
}

async function requireProfile(repositories: RoleProofRepositories, id: string) {
  const profile = await repositories.profiles.get(id);
  if (profile === undefined) throw new CliError(2, 'The requested profile was not found.');
  return profile;
}

async function closeAnalyzeStorage(database: StorageDatabase): Promise<void> {
  try {
    await closeStorage(database);
  } catch {
    throw new CliError(5, 'Storage operation failed. Check the database path and permissions.');
  }
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function isJobUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function deliverWebhook(
  options: AnalyzeOptions,
  body: string,
  output: CliOutput,
): Promise<void> {
  if (options.webhook === undefined) return;
  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.webhookTimeoutMs);
  try {
    response = await fetch(options.webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body,
      signal: controller.signal,
    });
  } catch {
    const result = WebhookDeliveryResultSchema.parse({
      schemaVersion: '1.0',
      url: options.webhook,
      status: 'failed',
      error: 'Webhook delivery failed. Check the endpoint and network access.',
    });
    output.writeErr(`roleproof: ${JSON.stringify(result)}\n`);
    throw new CliError(1, 'Webhook delivery failed. Check the endpoint and network access.');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const result = WebhookDeliveryResultSchema.parse({
      schemaVersion: '1.0',
      url: options.webhook,
      status: 'failed',
      statusCode: response.status,
      error: 'Webhook endpoint returned a non-success status.',
    });
    output.writeErr(`roleproof: ${JSON.stringify(result)}\n`);
    throw new CliError(1, 'Webhook endpoint returned a non-success status.');
  }
  const result = WebhookDeliveryResultSchema.parse({
    schemaVersion: '1.0',
    url: options.webhook,
    status: 'delivered',
    statusCode: response.status,
  });
  output.writeErr(`roleproof: ${JSON.stringify(result)}\n`);
  output.writeErr('roleproof: Webhook delivered.\n');
}

function writeTransmissionPreview(provider: AIProvider, output: CliOutput): void {
  const config = provider.config;
  const redactions = [
    ...(config.redaction.email ? ['email'] : []),
    ...(config.redaction.phone ? ['phone'] : []),
    ...(config.redaction.address ? ['address'] : []),
    ...(config.redaction.confidentialEmployerNames ? ['confidential-employer-name'] : []),
    ...(config.redaction.clearanceDetails ? ['clearance-detail'] : []),
    ...(config.redaction.userSelectedTerms.length > 0 ? ['user-selected-term'] : []),
  ];
  output.writeErr(
    [
      'RoleProof provider transmission preview:',
      `Provider: ${config.provider}`,
      `Model: ${config.model}`,
      `Destination: ${config.destination}`,
      `Endpoint origin: ${provider.endpointOrigin}`,
      'Data categories: job-summary, resume-summary, requirement-text, evidence-summary, baseline-classification',
      `Redaction categories: ${redactions.join(', ') || 'none'}`,
      config.destination === 'local'
        ? 'Career data remains directed to the configured local endpoint.'
        : 'Career data leaves this machine for the configured endpoint.',
      '',
    ].join('\n'),
  );
}

async function enhanceBaseline(
  options: AnalyzeOptions,
  config: ProviderConfig | undefined,
  provider: AIProvider | undefined,
  analysis: ReturnType<typeof analyzeDeterministic>,
  requirements: JobRequirement[],
  evidence: CareerEvidence[],
  output: CliOutput,
  repositories?: RoleProofRepositories,
): Promise<{
  reports: { json: string; markdown: string };
  providerFailed: boolean;
}> {
  if (options.provider === undefined) {
    return {
      reports: { json: renderJson(analysis), markdown: renderMarkdown(analysis) },
      providerFailed: false,
    };
  }
  if (config === undefined) throw new CliError(2, 'Provider configuration is invalid.');
  const existing = await repositories?.aiEnhancements.get(analysis.id);
  if (existing !== undefined) {
    if (existing.configFingerprint !== providerConfigFingerprint(config)) {
      throw new CliError(5, 'Stored enhancement uses a different provider configuration.');
    }
    return {
      reports: {
        json: renderEnhancedJson(analysis, existing.enhancement),
        markdown: renderEnhancedMarkdown(analysis, existing.enhancement),
      },
      providerFailed: false,
    };
  }

  if (provider === undefined) throw new CliError(2, 'Provider configuration is invalid.');
  const inputs = buildProviderInputs(analysis, requirements, evidence);
  writeTransmissionPreview(provider, output);
  const started = new Date();
  const result = await enhanceAnalysisWithFallback(
    analysis,
    provider,
    inputs.requirementAnalysis,
    inputs.evidenceMapping,
    inputs.applicationSuggestions,
    [...new Set(evidence.flatMap((item) => (item.employer === undefined ? [] : [item.employer])))],
  );
  if (result.enhancement !== undefined) {
    await repositories?.aiEnhancements.save(result.enhancement, providerConfigFingerprint(config));
    return {
      reports: {
        json: renderEnhancedJson(analysis, result.enhancement),
        markdown: renderEnhancedMarkdown(analysis, result.enhancement),
      },
      providerFailed: false,
    };
  }

  const completed = new Date();
  if (repositories !== undefined && result.error !== undefined) {
    await repositories.providerCalls.recordFailure({
      baselineAnalysisId: analysis.id,
      provider: config.provider,
      model: config.model,
      operation: result.error.operation,
      destination: config.destination,
      endpointOrigin: provider.endpointOrigin,
      errorCode: result.error.code,
      ...(result.failureManifest === undefined ? {} : { manifest: result.failureManifest }),
      completedExecutions: [...(result.completedExecutions ?? [])],
      ...(result.failedExecution === undefined ? {} : { failedExecution: result.failedExecution }),
      requestId: null,
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      durationMs: Math.max(0, completed.getTime() - started.getTime()),
    });
  }
  const errorSummary =
    result.error === undefined
      ? ''
      : ` (${result.error.code} during ${result.error.operation})${result.error.detail === undefined ? '' : `: ${result.error.detail}`}`;
  output.writeErr(
    `RoleProof: provider enhancement failed${errorSummary}; using deterministic fallback.\n`,
  );
  return {
    reports: { json: renderJson(analysis), markdown: renderMarkdown(analysis) },
    providerFailed: true,
  };
}

async function readStdin(input: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of input) {
    chunks.push(
      typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk),
    );
  }
  return new Uint8Array(Buffer.concat(chunks.map((part) => Buffer.from(part))));
}

interface PipelineOutcome {
  analysis: AnalysisLike;
  reports: { json: string; markdown: string };
  providerFailed: boolean;
}

async function runAnalysisPipeline(
  options: AnalyzeOptions,
  providerConfig: ProviderConfig | undefined,
  configuredProvider: AIProvider | undefined,
  resumeFile: ParsedDocumentFile,
  jobFile: JobInput,
  output: CliOutput,
  repositories: RoleProofRepositories | undefined,
  profile: CandidateProfile | undefined,
): Promise<PipelineOutcome> {
  if (!options.store && options.profile === undefined) {
    const analysisBase = AnalysisResultSchema.parse(
      analyzeDeterministic({
        resume: resumeFile.document,
        job: jobFile.document,
        candidateContext: candidateContext(options),
      }),
    ) as AnalysisLike;
    const analysis: AnalysisLike =
      jobFile.source === undefined
        ? analysisBase
        : (AnalysisResultSchema.parse({
            ...analysisBase,
            metadata: { ...analysisBase.metadata, jobSource: jobFile.source },
          }) as AnalysisLike);
    const requirements = extractJobRequirements(
      jobFile.document,
      DEFAULT_NORMALIZATION_DATA.aliases,
    ).requirements;
    const evidence = extractCareerEvidence(resumeFile.document, DEFAULT_NORMALIZATION_DATA.aliases);
    const enhanced = await enhanceBaseline(
      options,
      providerConfig,
      configuredProvider,
      analysis,
      requirements,
      evidence,
      output,
    );
    return { analysis, reports: enhanced.reports, providerFailed: enhanced.providerFailed };
  }

  const repositoriesOrThrow = repositories;
  const profileOrThrow = profile;
  if (repositoriesOrThrow === undefined || profileOrThrow === undefined) {
    throw new CliError(5, 'Storage is not available for the selected profile.');
  }
  const profileId = profileOrThrow.id;
  const documentId = stableId('document', profileId, resumeFile.document.id);
  const activeResume = { ...resumeFile.document, id: documentId };
  const extractedEvidence = extractCareerEvidence(
    activeResume,
    DEFAULT_NORMALIZATION_DATA.aliases,
    { profileId },
  );
  const documentInput: Omit<StoredDocument, 'createdAt' | 'updatedAt'> = {
    schemaVersion: '1.0',
    id: documentId,
    profileId,
    kind: 'resume',
    format: activeResume.format,
    originalName: resumeFile.originalName,
    contentSha256: resumeFile.contentSha256,
    parsedContentSha256: sha256(activeResume.text),
    text: activeResume.text,
    confidence: activeResume.confidence,
    warnings: activeResume.warnings,
  };
  const duplicate = options.store
    ? await repositoriesOrThrow.documents.insert(documentInput, extractedEvidence)
    : await repositoriesOrThrow.documents.findDuplicate(
        profileId,
        documentInput.contentSha256,
        documentInput.parsedContentSha256,
      );
  const storedResume =
    duplicate.status === 'none'
      ? options.store
        ? await repositoriesOrThrow.documents.get(documentId)
        : undefined
      : duplicate.document;
  const analysisResume = storedResume === undefined ? activeResume : parsedResume(storedResume);
  const activeEvidence =
    storedResume === undefined
      ? extractedEvidence
      : await repositoriesOrThrow.evidence.listByDocument(storedResume.id);
  const evidence =
    options.profile === undefined
      ? activeEvidence
      : [
          ...new Map(
            [
              ...(await repositoriesOrThrow.evidence.listByProfile(profileId)),
              ...activeEvidence,
            ].map((item) => [item.id, item]),
          ).values(),
        ];

  let analysisJob = jobFile.document;
  const requirements = extractJobRequirements(
    jobFile.document,
    DEFAULT_NORMALIZATION_DATA.aliases,
  ).requirements;
  if (options.store) {
    const storedJob = await repositoriesOrThrow.jobs.save(
      {
        schemaVersion: '1.0',
        id: jobFile.document.id,
        format: 'plaintext',
        contentSha256: jobFile.contentSha256,
        parsedContentSha256: sha256(jobFile.document.text),
        text: jobFile.document.text,
        confidence: jobFile.document.confidence,
        warnings: jobFile.document.warnings,
      },
      requirements,
    );
    if (jobFile.source !== undefined) {
      await repositoriesOrThrow.jobSources.saveSource({
        ...jobFile.source,
        jobId: storedJob.id,
      });
    }
    analysisJob = {
      schemaVersion: '1.0',
      id: storedJob.id,
      kind: 'job',
      format: 'plaintext',
      text: storedJob.text,
      confidence: storedJob.confidence,
      warnings: storedJob.warnings,
    };
  }

  const analysisContext = candidateContext(options, profileOrThrow);
  const analysisBase = AnalysisResultSchema.parse(
    analyzeDeterministicWithEvidence({
      resume: analysisResume,
      job: analysisJob,
      candidateContext: analysisContext,
      profileId,
      evidence,
    }),
  ) as AnalysisLike;
  const analysis: AnalysisLike =
    jobFile.source === undefined
      ? analysisBase
      : (AnalysisResultSchema.parse({
          ...analysisBase,
          metadata: { ...analysisBase.metadata, jobSource: jobFile.source },
        }) as AnalysisLike);
  const baselineReports = { json: renderJson(analysis), markdown: renderMarkdown(analysis) };
  if (options.store && (await repositoriesOrThrow.analyses.get(analysis.id)) === undefined) {
    await repositoriesOrThrow.analyses.save(
      analysis,
      buildEvidenceReferences(analysis, evidence, profileFactEvidenceIds(analysisContext)),
      baselineReports.markdown,
    );
  }
  const enhanced = await enhanceBaseline(
    options,
    providerConfig,
    configuredProvider,
    analysis,
    requirements,
    evidence,
    output,
    options.store ? repositoriesOrThrow : undefined,
  );
  return { analysis, reports: enhanced.reports, providerFailed: enhanced.providerFailed };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await mapper(item, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function pairFailureCode(error: unknown): number {
  if (error instanceof ParserError) return 3;
  if (error instanceof StorageError) return 5;
  if (error instanceof CliError) return error.exitCode;
  return 1;
}

function pairFailureMessage(error: unknown): string {
  if (error instanceof ParserError) return error.message;
  if (error instanceof StorageError) {
    return 'Storage operation failed. Check the database path and permissions.';
  }
  if (error instanceof CliError) return error.message;
  return 'Analysis failed. Verify the inputs and try again.';
}

async function runBatchAnalysis(
  options: AnalyzeOptions,
  providerConfig: ProviderConfig | undefined,
  configuredProvider: AIProvider | undefined,
  output: CliOutput,
  state: CliState,
  command: Command,
): Promise<void> {
  const manifestPath = resolve(options.manifest!);
  let rawManifest: string;
  try {
    rawManifest = await readFile(manifestPath, 'utf8');
  } catch {
    throw new CliError(
      3,
      'Unable to read the batch manifest. Check the manifest path and permissions.',
    );
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(rawManifest.replace(/^\uFEFF/, ''));
  } catch {
    throw new CliError(2, 'Invalid batch manifest: content is not valid JSON.');
  }
  const manifestResult = BatchManifestSchema.safeParse(manifestJson);
  if (!manifestResult.success) {
    throw new CliError(
      2,
      `Invalid batch manifest: ${manifestResult.error.issues[0]?.message ?? 'schema violation'}`,
    );
  }
  const manifest: BatchManifest = manifestResult.data;
  if (manifest.pairs.length > DEFAULT_BATCH_CONFIG.maxPairs) {
    throw new CliError(
      2,
      `Batch manifest exceeds the maximum of ${DEFAULT_BATCH_CONFIG.maxPairs} pairs.`,
    );
  }

  const manifestDirectory = dirname(manifestPath);
  const concurrency = options.concurrency ?? DEFAULT_BATCH_CONFIG.defaultConcurrency;
  let database: StorageDatabase | undefined;
  try {
    if (options.store) {
      const path = databasePath(command);
      database = await openStorage({ ...(path === undefined ? {} : { path }) });
    }
    const repositories = database === undefined ? undefined : createRoleProofRepositories(database);
    const profile =
      repositories === undefined ? undefined : await repositories.profiles.ensureDefault();

    const results = await mapWithConcurrency(manifest.pairs, concurrency, async (pair) => {
      const resumePath = resolve(manifestDirectory, pair.resume);
      const jobPath = resolve(manifestDirectory, pair.job);
      try {
        const [resumeFile, jobInput] = await Promise.all([
          parseDocumentFileWithMetadata(resumePath, 'resume'),
          parseDocumentFileWithMetadata(jobPath, 'job'),
        ]);
        const jobFile: JobInput = { ...jobInput, source: undefined };
        const outcome = await runAnalysisPipeline(
          options,
          providerConfig,
          configuredProvider,
          resumeFile,
          jobFile,
          output,
          repositories,
          profile,
        );
        return {
          status: 'completed' as const,
          resumeDocumentId: outcome.analysis.resumeDocumentId ?? resumeFile.document.id,
          jobId: outcome.analysis.jobId ?? jobFile.document.id,
          analysis: outcome.analysis,
        };
      } catch (error) {
        return {
          status: 'failed' as const,
          code: pairFailureCode(error),
          error: pairFailureMessage(error),
        };
      }
    });

    const envelope = BatchEnvelopeSchema.parse({ schemaVersion: '1.0', pairs: results });
    await writeBatchOutput(options, envelope, output);
    await deliverWebhook(options, renderBatchJson(envelope), output);
    const failed = results.filter((result) => result.status === 'failed');
    if (failed.length === 0) {
      state.exitCode = 0;
      return;
    }
    state.exitCode = failed.some((result) => result.code === 3)
      ? 3
      : failed.some((result) => result.code === 5)
        ? 5
        : 1;
    output.writeErr(`roleproof: ${failed.length} of ${results.length} batch pairs failed.\n`);
  } finally {
    if (database !== undefined) {
      await closeAnalyzeStorage(database);
    }
  }
}

export function registerAnalyzeCommand(
  program: Command,
  output: CliOutput,
  state: CliState,
  stdin: NodeJS.ReadableStream,
): void {
  program
    .command('analyze')
    .description('Analyze a resume against a job description or job URL')
    .option('--resume <path>', 'Path to a plaintext, PDF, or DOCX resume')
    .option('--stdin-resume', 'Read the resume as plaintext from stdin')
    .option('--job <path-or-url>', 'Path to a plaintext job description or HTTP(S) job URL')
    .option('--stdin-job', 'Read the job description as plaintext from stdin')
    .option('--format <format>', 'Output format: markdown, json, or both', 'markdown')
    .option('--out <directory>', 'Write report files to this directory')
    .option('--stdout', 'Write a single selected format to stdout', false)
    .option('--no-ai', 'Use deterministic analysis without AI')
    .option('--no-store', 'Do not persist analysis content')
    .option('--profile <id>', 'Stored candidate profile ID')
    .option('--target-salary-min <number>', 'Candidate minimum annual salary')
    .option('--target-salary-max <number>', 'Candidate maximum annual salary')
    .option('--location <value>', 'Candidate preferred location')
    .option('--remote-preference <value>', 'remote, hybrid, onsite, or any')
    .option('--provider <provider>', 'Provider: openai or openai-compatible')
    .option('--model <model>', 'Provider model')
    .option('--base-url <url>', 'OpenAI-compatible API base URL')
    .option('--destination <destination>', 'Destination: hosted, local, or custom')
    .option('--confirm-transmission', 'Confirm hosted or custom career-data transmission')
    .option('--structured-output-mode <mode>', 'Structured output: json-schema or json-object')
    .option('--provider-timeout-ms <number>', 'Provider request timeout')
    .option('--max-input-chars <number>', 'Maximum provider input characters')
    .option('--max-output-tokens <number>', 'Maximum output tokens')
    .option('--max-total-tokens <number>', 'Maximum aggregate tokens')
    .option('--max-cost-usd <number>', 'Maximum provider cost in USD')
    .option('--input-cost-per-million-usd <number>', 'Input rate per million tokens in USD')
    .option('--output-cost-per-million-usd <number>', 'Output rate per million tokens in USD')
    .option('--redact-employer', 'Redact confidential employer names')
    .option('--redact-clearance', 'Redact clearance details')
    .option('--redact-term <term>', 'Redact a selected term (repeatable)', collect, [])
    .option('--manifest <path>', 'JSON manifest of resume/job pairs for batch analysis')
    .option('--concurrency <number>', 'Maximum concurrent batch analyses', '4')
    .option('--webhook <url>', 'POST the JSON analysis or batch envelope to an explicit webhook')
    .option(
      '--confirm-webhook-transmission',
      'Confirm sending career analysis data to a non-local webhook URL',
    )
    .option('--webhook-timeout-ms <number>', 'Webhook delivery timeout in milliseconds')
    .action(async (rawOptions: unknown, command: Command) => {
      const parsedOptions = AnalyzeOptionsSchema.safeParse(rawOptions);
      if (!parsedOptions.success) {
        throw new CliError(2, parsedOptions.error.issues[0]?.message ?? 'Invalid analyze options.');
      }
      const options = parsedOptions.data;
      const providerConfig =
        options.provider === undefined
          ? undefined
          : buildProviderConfig({
              ...options,
              provider: options.provider,
              model: options.model!,
            });
      const configuredProvider =
        providerConfig === undefined ? undefined : createConfiguredProvider(providerConfig);
      let database: StorageDatabase | undefined;

      try {
        if (options.manifest !== undefined) {
          await runBatchAnalysis(
            options,
            providerConfig,
            configuredProvider,
            output,
            state,
            command,
          );
          return;
        }

        const stdinContent =
          options.stdinResume || options.stdinJob ? await readStdin(stdin) : undefined;
        const [resumeFile, jobInput] = await Promise.all([
          options.stdinResume
            ? parsePlaintextBytesWithMetadata(stdinContent!, 'resume')
            : parseDocumentFileWithMetadata(options.resume!, 'resume'),
          options.stdinJob
            ? parsePlaintextBytesWithMetadata(stdinContent!, 'job')
            : isJobUrl(options.job!)
              ? parseJobUrlWithMetadata(options.job!)
              : parseDocumentFileWithMetadata(options.job!, 'job'),
        ]);
        const jobFile: JobInput =
          'source' in jobInput ? jobInput : { ...jobInput, source: undefined };

        if (!options.store && options.profile === undefined) {
          const outcome = await runAnalysisPipeline(
            options,
            providerConfig,
            configuredProvider,
            resumeFile,
            jobFile,
            output,
            undefined,
            undefined,
          );
          await writeAnalysisOutput(options, outcome.reports, output);
          await deliverWebhook(options, outcome.reports.json, output);
          state.exitCode = outcome.providerFailed
            ? 4
            : outcome.analysis.hardBlockers.length > 0
              ? 10
              : 0;
          return;
        }

        const path = databasePath(command);
        database = await openStorage({
          ...(path === undefined ? {} : { path }),
          ...(!options.store ? { readOnly: true } : {}),
        });
        const repositories = createRoleProofRepositories(database);
        const profileId = options.profile ?? DEFAULT_PROFILE_ID;
        const profile =
          options.profile === undefined
            ? await repositories.profiles.ensureDefault()
            : await requireProfile(repositories, profileId);
        const outcome = await runAnalysisPipeline(
          options,
          providerConfig,
          configuredProvider,
          resumeFile,
          jobFile,
          output,
          repositories,
          profile,
        );
        if (database !== undefined) {
          await closeAnalyzeStorage(database);
          database = undefined;
        }
        await writeAnalysisOutput(options, outcome.reports, output);
        await deliverWebhook(options, outcome.reports.json, output);
        state.exitCode = outcome.providerFailed
          ? 4
          : outcome.analysis.hardBlockers.length > 0
            ? 10
            : 0;
      } catch (error) {
        if (error instanceof CliError) throw error;
        if (error instanceof ParserError) throw new CliError(3, error.message);
        if (error instanceof StorageError) {
          throw new CliError(
            5,
            'Storage operation failed. Check the database path and permissions.',
          );
        }
        throw new CliError(1, 'Analysis failed. Verify the inputs and try again.');
      } finally {
        if (database !== undefined) {
          await closeAnalyzeStorage(database);
        }
      }
    });
}

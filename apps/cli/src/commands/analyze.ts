import { createHash } from 'node:crypto';

import {
  analyzeDeterministic,
  analyzeDeterministicWithEvidence,
  buildEvidenceReferences,
  DEFAULT_NORMALIZATION_DATA,
  extractCareerEvidence,
  extractJobRequirements,
  profileFactEvidenceIds,
} from '@roleproof/core';
import { ParserError, parseDocumentFileWithMetadata } from '@roleproof/parsers';
import {
  buildProviderInputs,
  enhanceAnalysisWithFallback,
  providerConfigFingerprint,
  type AIProvider,
} from '@roleproof/providers';
import {
  renderEnhancedJson,
  renderEnhancedMarkdown,
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
  CandidateContextSchema,
  type CandidateProfile,
  type CareerEvidence,
  type JobRequirement,
  type ParsedDocument,
  type ProviderConfig,
  type StoredDocument,
} from '@roleproof/shared';
import type { Command } from 'commander';

import { CliError } from '../errors.js';
import { writeAnalysisOutput } from '../output.js';
import type { CliOutput, CliState } from '../program.js';
import { AnalyzeOptionsSchema, type AnalyzeOptions } from './analyze-options.js';
import { buildProviderConfig, createConfiguredProvider } from './provider-config.js';

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
  output.writeErr('RoleProof: provider enhancement failed; using deterministic fallback.\n');
  return {
    reports: { json: renderJson(analysis), markdown: renderMarkdown(analysis) },
    providerFailed: true,
  };
}

export function registerAnalyzeCommand(program: Command, output: CliOutput, state: CliState): void {
  program
    .command('analyze')
    .description('Analyze a local resume against a local plaintext job description')
    .requiredOption('--resume <path>', 'Path to a plaintext, PDF, or DOCX resume')
    .requiredOption('--job <path>', 'Path to a plaintext job description')
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
        const [resumeFile, jobFile] = await Promise.all([
          parseDocumentFileWithMetadata(options.resume, 'resume'),
          parseDocumentFileWithMetadata(options.job, 'job'),
        ]);

        if (!options.store && options.profile === undefined) {
          const analysis = analyzeDeterministic({
            resume: resumeFile.document,
            job: jobFile.document,
            candidateContext: candidateContext(options),
          });
          const requirements = extractJobRequirements(
            jobFile.document,
            DEFAULT_NORMALIZATION_DATA.aliases,
          ).requirements;
          const evidence = extractCareerEvidence(
            resumeFile.document,
            DEFAULT_NORMALIZATION_DATA.aliases,
          );
          const enhanced = await enhanceBaseline(
            options,
            providerConfig,
            configuredProvider,
            analysis,
            requirements,
            evidence,
            output,
          );
          await writeAnalysisOutput(options, enhanced.reports, output);
          state.exitCode = enhanced.providerFailed ? 4 : analysis.hardBlockers.length > 0 ? 10 : 0;
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
          ? await repositories.documents.insert(documentInput, extractedEvidence)
          : await repositories.documents.findDuplicate(
              profileId,
              documentInput.contentSha256,
              documentInput.parsedContentSha256,
            );
        const storedResume =
          duplicate.status === 'none'
            ? options.store
              ? await repositories.documents.get(documentId)
              : undefined
            : duplicate.document;
        const analysisResume =
          storedResume === undefined ? activeResume : parsedResume(storedResume);
        const activeEvidence =
          storedResume === undefined
            ? extractedEvidence
            : await repositories.evidence.listByDocument(storedResume.id);
        const evidence =
          options.profile === undefined
            ? activeEvidence
            : [
                ...new Map(
                  [
                    ...(await repositories.evidence.listByProfile(profileId)),
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
          const storedJob = await repositories.jobs.save(
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

        const analysisContext = candidateContext(options, profile);
        const analysis = analyzeDeterministicWithEvidence({
          resume: analysisResume,
          job: analysisJob,
          candidateContext: analysisContext,
          profileId,
          evidence,
        });
        const baselineReports = { json: renderJson(analysis), markdown: renderMarkdown(analysis) };
        if (options.store && (await repositories.analyses.get(analysis.id)) === undefined) {
          await repositories.analyses.save(
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
          options.store ? repositories : undefined,
        );
        if (database !== undefined) {
          await closeAnalyzeStorage(database);
          database = undefined;
        }
        await writeAnalysisOutput(options, enhanced.reports, output);
        state.exitCode = enhanced.providerFailed ? 4 : analysis.hardBlockers.length > 0 ? 10 : 0;
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

import { createHash } from 'node:crypto';

import {
  analyzeDeterministic,
  analyzeDeterministicWithEvidence,
  DEFAULT_NORMALIZATION_DATA,
  extractCareerEvidence,
  extractJobRequirements,
} from '@roleproof/core';
import { ParserError, parseDocumentFileWithMetadata } from '@roleproof/parsers';
import { renderJson, renderMarkdown } from '@roleproof/reporters';
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
  EvidenceReferenceSchema,
  type CandidateProfile,
  type CandidateContext,
  type CareerEvidence,
  type EvidenceReference,
  type ParsedDocument,
  type StoredDocument,
} from '@roleproof/shared';
import type { Command } from 'commander';

import { CliError } from '../errors.js';
import { writeAnalysisOutput } from '../output.js';
import type { CliOutput, CliState } from '../program.js';
import { AnalyzeOptionsSchema, type AnalyzeOptions } from './analyze-options.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${sha256(parts.join('\0')).slice(0, 24)}`;
}

function profileFactEvidenceIds(context: CandidateContext): Set<string> {
  const values: Array<[string, string]> = [
    ...(context.workAuthorization === undefined
      ? []
      : ([['authorization', context.workAuthorization]] as Array<[string, string]>)),
    ...context.education.map((value): [string, string] => ['education', value]),
    ...context.certifications.map((value): [string, string] => ['education', value]),
    ...context.licenses.map((value): [string, string] => ['license', value]),
    ...context.preferredLocations.map((value): [string, string] => ['location', value]),
    ...(context.remotePreference === undefined
      ? []
      : ([['location', context.remotePreference]] as Array<[string, string]>)),
    ...context.clearances.map((value): [string, string] => ['clearance', value]),
  ];
  return new Set(
    values.map(
      ([category, value]) => `evidence-context-${sha256(`${category}\0${value}`).slice(0, 16)}`,
    ),
  );
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

function referencesFor(
  result: {
    profileId?: string | undefined;
    resumeDocumentId?: string | undefined;
    matchedRequirements: { evidenceIds: string[] }[];
    unsupportedClaims: { evidenceIds: string[] }[];
    suggestedEmphasis: { evidenceIds: string[] }[];
    suggestedAdditions: { evidenceIds: string[] }[];
    scoreContributions: { evidenceIds: string[] }[];
  },
  evidence: CareerEvidence[],
  profileFactIds: Set<string>,
): EvidenceReference[] {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const citedIds = new Set(
    [
      ...result.matchedRequirements,
      ...result.unsupportedClaims,
      ...result.suggestedEmphasis,
      ...result.suggestedAdditions,
      ...result.scoreContributions,
    ].flatMap(({ evidenceIds }) => evidenceIds),
  );
  return [...citedIds].sort().map((evidenceId) => {
    const careerEvidence = evidenceById.get(evidenceId);
    return EvidenceReferenceSchema.parse(
      careerEvidence === undefined && profileFactIds.has(evidenceId)
        ? {
            evidenceId,
            sourceType: 'profile-fact',
            sourceId: result.profileId,
            confidence: 'user-confirmed',
          }
        : careerEvidence === undefined
          ? {
              evidenceId,
              sourceType: 'resume-text',
              sourceId: result.resumeDocumentId,
              sourceDocumentId: result.resumeDocumentId,
              confidence: 'explicit',
            }
          : {
              evidenceId,
              sourceType: 'career-evidence',
              sourceId: careerEvidence.id,
              sourceDocumentId: careerEvidence.sourceDocumentId,
              ...(careerEvidence.sourceText === undefined
                ? {}
                : { sourceText: careerEvidence.sourceText }),
              confidence: careerEvidence.confidence,
            },
    );
  });
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

export function registerAnalyzeCommand(program: Command, output: CliOutput, state: CliState): void {
  program
    .command('analyze')
    .description('Analyze a local resume against a local plaintext job description')
    .requiredOption('--resume <path>', 'Path to a plaintext or PDF resume')
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
    .action(async (rawOptions: unknown, command: Command) => {
      const parsedOptions = AnalyzeOptionsSchema.safeParse(rawOptions);
      if (!parsedOptions.success) {
        throw new CliError(2, parsedOptions.error.issues[0]?.message ?? 'Invalid analyze options.');
      }
      const options = parsedOptions.data;
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
          await writeAnalysisOutput(
            options,
            { json: renderJson(analysis), markdown: renderMarkdown(analysis) },
            output,
          );
          state.exitCode = analysis.hardBlockers.length > 0 ? 10 : 0;
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
        if (options.store) {
          const requirements = extractJobRequirements(
            jobFile.document,
            DEFAULT_NORMALIZATION_DATA.aliases,
          ).requirements;
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
        const reports = { json: renderJson(analysis), markdown: renderMarkdown(analysis) };
        if (options.store && (await repositories.analyses.get(analysis.id)) === undefined) {
          await repositories.analyses.save(
            analysis,
            referencesFor(analysis, evidence, profileFactEvidenceIds(analysisContext)),
            reports.markdown,
          );
        }
        if (database !== undefined) {
          await closeAnalyzeStorage(database);
          database = undefined;
        }
        await writeAnalysisOutput(options, reports, output);
        state.exitCode = analysis.hardBlockers.length > 0 ? 10 : 0;
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

import { createHash, randomUUID } from 'node:crypto';

import {
  DEFAULT_NORMALIZATION_DATA,
  extractCareerEvidence,
  normalizeSkillName,
} from '@roleproof/core';
import { ParserError, parseDocumentFileWithMetadata } from '@roleproof/parsers';
import { renderEnhancedMarkdown, renderMarkdown } from '@roleproof/reporters';
import {
  closeStorage,
  createRoleProofRepositories,
  DEFAULT_PROFILE_ID,
  openStorage,
  purgeStorage,
  StorageError,
  type RoleProofRepositories,
  type StorageDatabase,
} from '@roleproof/storage';
import {
  CommandEnvelopeSchema,
  EvidenceAddInputSchema,
  EvidenceEditInputSchema,
  ProfileCreateInputSchema,
  type CareerEvidence,
  type StoredDocument,
} from '@roleproof/shared';
import type { Command } from 'commander';

import { CliError } from '../errors.js';
import type { CliOutput } from '../program.js';

type TextFormat = 'text' | 'json';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${sha256(parts.join('\0')).slice(0, 24)}`;
}

function formatOption(value: string, allowed: readonly string[]): string {
  if (!allowed.includes(value)) {
    throw new CliError(2, `Invalid format. Expected ${allowed.join(' or ')}.`);
  }
  return value;
}

function databasePath(command: Command): string | undefined {
  const options: unknown = command.optsWithGlobals();
  if (typeof options !== 'object' || options === null || !('db' in options)) return undefined;
  return typeof options.db === 'string' ? options.db : undefined;
}

function writeJson(
  command: string,
  data: unknown,
  output: CliOutput,
  schemaVersion: '1.0' | '2.0' = '1.0',
): void {
  const envelope = CommandEnvelopeSchema.parse({ schemaVersion, command, data });
  output.writeOut(`${JSON.stringify(envelope, null, 2)}\n`);
}

function writeText(lines: string[], output: CliOutput): void {
  output.writeOut(`${lines.join('\n')}\n`);
}

function storageCliError(error: unknown): never {
  if (error instanceof CliError) throw error;
  if (error instanceof ParserError) throw new CliError(3, error.message);
  if (error instanceof StorageError) {
    if (error.code === 'NOT_FOUND')
      throw new CliError(2, 'The requested stored item was not found.');
    throw new CliError(5, 'Storage operation failed. Check the database path and permissions.');
  }
  throw error;
}

async function withRepositories<T>(
  command: Command,
  action: (repositories: RoleProofRepositories) => Promise<T>,
): Promise<T> {
  let database: StorageDatabase | undefined;
  try {
    const path = databasePath(command);
    database = await openStorage(path === undefined ? {} : { path });
    return await action(createRoleProofRepositories(database));
  } catch (error) {
    return storageCliError(error);
  } finally {
    if (database !== undefined) {
      try {
        await closeStorage(database);
      } catch (error) {
        storageCliError(error);
      }
    }
  }
}

async function requireProfile(repositories: RoleProofRepositories, id: string) {
  const profile = await repositories.profiles.get(id);
  if (profile === undefined) throw new CliError(2, 'The requested profile was not found.');
  return profile;
}

async function requireEvidence(repositories: RoleProofRepositories, id: string) {
  const evidence = await repositories.evidence.get(id);
  if (evidence === undefined) throw new CliError(2, 'The requested evidence was not found.');
  return evidence;
}

function textFormat(options: { format: string }): TextFormat {
  return formatOption(options.format, ['text', 'json']) as TextFormat;
}

function addFormat(command: Command): Command {
  return command.option('--format <format>', 'Output format: text or json', 'text');
}

function registerInit(program: Command, output: CliOutput): void {
  addFormat(program.command('init').description('Initialize local RoleProof storage')).action(
    async (options: { format: string }, command: Command) => {
      const format = textFormat(options);
      const profile = await withRepositories(command, (repositories) =>
        repositories.profiles.ensureDefault(),
      );
      if (format === 'json') writeJson('init', { profile }, output);
      else writeText([`Initialized RoleProof storage.`, `Profile: ${profile.id}`], output);
    },
  );
}

function registerProfile(program: Command, output: CliOutput): void {
  const profile = program.command('profile').description('Manage candidate profiles');

  addFormat(
    profile
      .command('create')
      .description('Create a profile')
      .requiredOption('--name <name>', 'Profile name'),
  ).action(async (options: { name: string; format: string }, command: Command) => {
    const format = textFormat(options);
    const input = ProfileCreateInputSchema.safeParse({ name: options.name });
    if (!input.success) throw new CliError(2, input.error.issues[0]?.message ?? 'Invalid profile.');
    const created = await withRepositories(command, (repositories) =>
      repositories.profiles.create({
        id: `profile-${randomUUID()}`,
        name: input.data.name,
        targetTitles: [],
        preferredLocations: [],
      }),
    );
    if (format === 'json') writeJson('profile.create', { profile: created }, output);
    else writeText([`Created profile ${created.id}.`, `Name: ${created.name}`], output);
  });

  addFormat(
    profile.command('show').description('Show a profile').option('--profile <id>', 'Profile ID'),
  ).action(async (options: { profile?: string; format: string }, command: Command) => {
    const format = textFormat(options);
    const id = options.profile ?? DEFAULT_PROFILE_ID;
    const data = await withRepositories(command, async (repositories) => {
      if (options.profile === undefined) await repositories.profiles.ensureDefault();
      const storedProfile = await requireProfile(repositories, id);
      const [documents, evidence] = await Promise.all([
        repositories.documents.listByProfile(id),
        repositories.evidence.listByProfile(id),
      ]);
      return { profile: storedProfile, documents, evidence };
    });
    if (format === 'json') writeJson('profile.show', data, output);
    else {
      writeText(
        [
          `Profile: ${data.profile.name ?? data.profile.id}`,
          `Documents: ${data.documents.length}`,
          ...data.documents.map((document) => `- ${document.id} (${document.kind})`),
          `Evidence: ${data.evidence.length}`,
          ...data.evidence.map((evidence) => `- ${evidence.id}: ${evidence.name}`),
        ],
        output,
      );
    }
  });

  registerEvidence(profile, output);
}

function registerEvidence(profile: Command, output: CliOutput): void {
  const evidence = profile.command('evidence').description('Manage career evidence');
  addFormat(
    evidence
      .command('add')
      .description('Add career evidence')
      .requiredOption('--profile <id>', 'Profile ID')
      .option('--resume <path>', 'Resume path')
      .option('--category <category>', 'Evidence category')
      .option('--name <name>', 'Evidence name')
      .option('--description <description>', 'Evidence description'),
  ).action(
    async (
      options: {
        profile: string;
        resume?: string;
        category?: string;
        name?: string;
        description?: string;
        format: string;
      },
      command: Command,
    ) => {
      const format = textFormat(options);
      const raw =
        options.resume === undefined
          ? {
              profileId: options.profile,
              category: options.category,
              name: options.name,
              description: options.description,
            }
          : { profileId: options.profile, resume: options.resume };
      const input = EvidenceAddInputSchema.safeParse(raw);
      if (!input.success) {
        throw new CliError(
          2,
          'Use exactly one evidence source: --resume, or --category with --name and --description.',
        );
      }
      const data =
        'resume' in input.data
          ? await importResumeEvidence(command, input.data.profileId, input.data.resume)
          : await addManualEvidence(command, input.data);
      if (format === 'json') writeJson('profile.evidence.add', data, output);
      else {
        const count = Array.isArray(data.evidence) ? data.evidence.length : 1;
        writeText(
          [`${data.status === 'duplicate' ? 'Found' : 'Added'} ${count} evidence item(s).`],
          output,
        );
      }
    },
  );

  addFormat(
    evidence
      .command('edit')
      .description('Edit career evidence')
      .requiredOption('--evidence <id>', 'Evidence ID')
      .option('--category <category>')
      .option('--name <name>')
      .option('--normalized-name <name>')
      .option('--description <description>')
      .option('--employer <employer>')
      .option('--project <project>')
      .option('--start-date <date>')
      .option('--end-date <date>'),
  ).action(async (options: Record<string, string>, command: Command) => {
    const format = textFormat({ format: options.format ?? 'text' });
    const parsed = EvidenceEditInputSchema.safeParse({
      evidenceId: options.evidence,
      ...(options.category === undefined ? {} : { category: options.category }),
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.normalizedName === undefined ? {} : { normalizedName: options.normalizedName }),
      ...(options.description === undefined ? {} : { description: options.description }),
      ...(options.employer === undefined ? {} : { employer: options.employer }),
      ...(options.project === undefined ? {} : { project: options.project }),
      ...(options.startDate === undefined ? {} : { startDate: options.startDate }),
      ...(options.endDate === undefined ? {} : { endDate: options.endDate }),
    });
    if (!parsed.success)
      throw new CliError(2, parsed.error.issues[0]?.message ?? 'Invalid evidence edit.');
    const { evidenceId } = parsed.data;
    const update = {
      ...(parsed.data.category === undefined ? {} : { category: parsed.data.category }),
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(parsed.data.normalizedName === undefined
        ? {}
        : { normalizedName: parsed.data.normalizedName }),
      ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
      ...(parsed.data.employer === undefined ? {} : { employer: parsed.data.employer }),
      ...(parsed.data.project === undefined ? {} : { project: parsed.data.project }),
      ...(parsed.data.startDate === undefined ? {} : { startDate: parsed.data.startDate }),
      ...(parsed.data.endDate === undefined ? {} : { endDate: parsed.data.endDate }),
    };
    const updated = await withRepositories(command, async (repositories) => {
      await requireEvidence(repositories, evidenceId);
      return repositories.evidence.edit(evidenceId, update);
    });
    if (format === 'json') writeJson('profile.evidence.edit', { evidence: updated }, output);
    else writeText([`Updated evidence ${updated.id}.`], output);
  });

  addFormat(
    evidence
      .command('remove')
      .description('Remove career evidence')
      .requiredOption('--evidence <id>', 'Evidence ID'),
  ).action(async (options: { evidence: string; format: string }, command: Command) => {
    const format = textFormat(options);
    const removed = await withRepositories(command, async (repositories) => {
      await requireEvidence(repositories, options.evidence);
      return repositories.evidence.remove(options.evidence);
    });
    const data = { evidenceId: options.evidence, removed };
    if (format === 'json') writeJson('profile.evidence.remove', data, output);
    else writeText([`Removed evidence ${options.evidence}.`], output);
  });
}

async function importResumeEvidence(command: Command, profileId: string, path: string) {
  let parsed;
  try {
    parsed = await parseDocumentFileWithMetadata(path, 'resume');
  } catch (error) {
    storageCliError(error);
  }
  const id = stableId('document', profileId, parsed.document.id);
  const source = { ...parsed.document, id };
  const extracted = extractCareerEvidence(source, DEFAULT_NORMALIZATION_DATA.aliases, {
    profileId,
  });
  const document: Omit<StoredDocument, 'createdAt' | 'updatedAt'> = {
    schemaVersion: '1.0',
    id,
    profileId,
    kind: 'resume',
    format: source.format,
    originalName: parsed.originalName,
    contentSha256: parsed.contentSha256,
    parsedContentSha256: sha256(source.text),
    text: source.text,
    confidence: source.confidence,
    warnings: source.warnings,
  };
  return withRepositories(command, async (repositories) => {
    await requireProfile(repositories, profileId);
    const duplicate = await repositories.documents.insert(document, extracted);
    const stored =
      duplicate.status === 'none' ? await repositories.documents.get(id) : duplicate.document;
    if (stored === undefined)
      throw new StorageError('REPOSITORY_FAILED', 'Imported document was not found');
    const evidence = await repositories.evidence.listByDocument(stored.id);
    return {
      status: duplicate.status === 'none' ? ('imported' as const) : ('duplicate' as const),
      document: stored,
      evidence,
    };
  });
}

async function addManualEvidence(
  command: Command,
  input: {
    profileId: string;
    category: CareerEvidence['category'];
    name: string;
    description: string;
  },
) {
  const text = `${input.category}\n${input.name}\n${input.description}`;
  const hash = sha256(text);
  const documentId = stableId('document-note', input.profileId, hash);
  const evidenceId = stableId('evidence-user', input.profileId, hash);
  const document: Omit<StoredDocument, 'createdAt' | 'updatedAt'> = {
    schemaVersion: '1.0',
    id: documentId,
    profileId: input.profileId,
    kind: 'evidence-note',
    format: 'plaintext',
    contentSha256: hash,
    parsedContentSha256: hash,
    text,
    confidence: 1,
    warnings: [],
  };
  const evidence: CareerEvidence = {
    id: evidenceId,
    profileId: input.profileId,
    category: input.category,
    name: input.name,
    normalizedName:
      normalizeSkillName(input.name, DEFAULT_NORMALIZATION_DATA.aliases) ??
      input.name.trim().toLocaleLowerCase('en-US'),
    description: input.description,
    sourceDocumentId: documentId,
    sourceText: input.description,
    confidence: 'user-confirmed',
  };
  return withRepositories(command, async (repositories) => {
    await requireProfile(repositories, input.profileId);
    const duplicate = await repositories.documents.insert(document, [evidence]);
    const stored =
      duplicate.status === 'none'
        ? await repositories.documents.get(documentId)
        : duplicate.document;
    if (stored === undefined)
      throw new StorageError('REPOSITORY_FAILED', 'Evidence note was not found');
    const storedEvidence = (await repositories.evidence.listByDocument(stored.id))[0];
    if (storedEvidence === undefined)
      throw new StorageError('REPOSITORY_FAILED', 'Evidence was not found');
    return {
      status: duplicate.status === 'none' ? ('imported' as const) : ('duplicate' as const),
      document: stored,
      evidence: storedEvidence,
    };
  });
}

function registerReadCommands(program: Command, output: CliOutput): void {
  addFormat(
    program
      .command('history')
      .description('List analysis history')
      .option('--profile <id>', 'Profile ID'),
  ).action(async (options: { profile?: string; format: string }, command: Command) => {
    const format = textFormat(options);
    const history = await withRepositories(command, (repositories) =>
      repositories.analyses.listHistory(options.profile),
    );
    if (format === 'json') writeJson('history', { history }, output);
    else
      writeText(
        history.length === 0
          ? ['No stored analyses.']
          : history.map((item) => `${item.id}: ${item.recommendation} (${item.overallScore})`),
        output,
      );
  });

  addFormat(
    program
      .command('search')
      .description('Search stored data')
      .requiredOption('--query <text>', 'Search query'),
  ).action(async (options: { query: string; format: string }, command: Command) => {
    const format = textFormat(options);
    if (options.query.trim().length === 0) throw new CliError(2, 'Search query must not be blank.');
    const results = await withRepositories(command, (repositories) =>
      repositories.search.search(options.query),
    );
    if (format === 'json') writeJson('search', { results }, output);
    else
      writeText(
        results.length === 0
          ? ['No results.']
          : results.map((item) => `${item.entityType} ${item.id}: ${item.title}`),
        output,
      );
  });

  const report = program.command('report').description('Show stored reports');
  report
    .command('show')
    .description('Show a stored report')
    .requiredOption('--analysis <id>', 'Analysis ID')
    .option('--format <format>', 'Output format: markdown or json', 'markdown')
    .action(async (options: { analysis: string; format: string }, command: Command) => {
      const format = formatOption(options.format, ['markdown', 'json']);
      const stored = await withRepositories(command, async (repositories) => {
        const value = await repositories.analyses.get(options.analysis);
        if (value === undefined) throw new CliError(2, 'The requested analysis was not found.');
        const enhancement = await repositories.aiEnhancements.get(options.analysis);
        return { ...value, aiEnhancement: enhancement?.enhancement };
      });
      if (format === 'json') {
        writeJson(
          'report.show',
          {
            analysis: stored.result,
            evidenceReferences: stored.evidenceReferences,
            ...(stored.aiEnhancement === undefined ? {} : { aiEnhancement: stored.aiEnhancement }),
          },
          output,
          stored.aiEnhancement === undefined ? '1.0' : '2.0',
        );
      } else {
        output.writeOut(
          stored.aiEnhancement === undefined
            ? stored.report.trim().length > 0
              ? `${stored.report.trimEnd()}\n`
              : renderMarkdown(stored.result)
            : renderEnhancedMarkdown(stored.result, stored.aiEnhancement),
        );
      }
    });
}

function registerPurge(program: Command, output: CliOutput): void {
  const data = program.command('data').description('Manage local RoleProof data');
  addFormat(
    data
      .command('purge')
      .description('Delete local storage')
      .option('--yes', 'Confirm permanent deletion', false),
  ).action(async (options: { yes: boolean; format: string }, command: Command) => {
    const format = textFormat(options);
    if (!options.yes)
      throw new CliError(2, 'Data purge requires --yes for noninteractive operation.');
    try {
      const result = await purgeStorage(databasePath(command));
      if (format === 'json') writeJson('data.purge', result, output);
      else writeText(['RoleProof local data purged.'], output);
    } catch (error) {
      storageCliError(error);
    }
  });
}

export function registerStorageCommands(program: Command, output: CliOutput): void {
  registerInit(program, output);
  registerProfile(program, output);
  registerReadCommands(program, output);
  registerPurge(program, output);
}

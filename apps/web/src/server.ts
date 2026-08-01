import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
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
  DEFAULT_PARSER_CONFIG,
  ParserError,
  parseDocx,
  parsePdf,
  parsePlaintext,
} from '@roleproof/parsers';
import { renderMarkdown } from '@roleproof/reporters';
import {
  CandidateContextSchema,
  LocalAnalyzeRequestSchema,
  LocalAnalyzeResponseSchema,
  LocalHistoryListResponseSchema,
  LocalHistoryQuerySchema,
  LocalResumeParseErrorSchema,
  LocalResumeParseResponseSchema,
  LocalResumeUploadMetadataSchema,
  LocalSettingsPatchSchema,
  LocalSettingsResponseSchema,
  type AnalysisResult,
  type CareerEvidence,
  type CandidateContext,
  type ParsedDocument,
  type StoredDocument,
} from '@roleproof/shared';
import {
  StorageError,
  toAnalysisHistoryItem,
  type AnalysisHistoryItem,
  type RoleProofRepositories,
} from '@roleproof/storage';

export const DEFAULT_SERVE_HOST = 'localhost';
export const DEFAULT_SERVE_PORT = 4173;

export interface LocalWebAppOptions {
  repositories?: RoleProofRepositories;
  databasePath?: string;
}

export interface LocalHealthResponse {
  schemaVersion: '1.0';
  status: 'ok';
  mode: 'local';
  accountRequired: false;
  cloudRequired: false;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${sha256(parts.join('\0')).slice(0, 24)}`;
}

function emptyCandidateContext(): CandidateContext {
  return CandidateContextSchema.parse({
    preferredLocations: [],
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

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

async function directoryExists(directory: string): Promise<boolean> {
  try {
    await access(directory);
    return true;
  } catch {
    return false;
  }
}

async function resolveUiRoot(): Promise<string | null> {
  const candidates = [
    path.join(moduleDirectory, 'public'),
    path.join(moduleDirectory, '..', 'dist', 'public'),
  ];
  for (const candidate of candidates) {
    if (await directoryExists(candidate)) return candidate;
  }
  return null;
}

function contentType(filePath: string): string {
  if (filePath.endsWith('.svg')) return 'image/svg+xml; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function safeRootAssetPath(uiRoot: string, url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url, 'http://localhost').pathname;
  } catch {
    return null;
  }

  const name = path.posix.basename(pathname);
  if (
    name !== pathname.slice(1) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:svg|webmanifest|png|ico)$/u.test(name)
  ) {
    return null;
  }
  return path.join(uiRoot, name);
}

export function createLocalWebApp(options: LocalWebAppOptions = {}): FastifyInstance {
  const { repositories, databasePath } = options;
  const app = Fastify({ logger: false });
  void app.register(multipart, {
    limits: {
      files: 1,
      fileSize: DEFAULT_PARSER_CONFIG.maxPdfBytes,
      fields: 0,
      parts: 1,
    },
  });

  const sendUiShell = async (_request: FastifyRequest, reply: FastifyReply) => {
    const uiRoot = await resolveUiRoot();
    if (uiRoot === null) return reply.code(404).send({ error: 'Local UI assets are not built.' });
    const indexPath = path.join(uiRoot, 'index.html');
    return reply.type(contentType(indexPath)).send(await readFile(indexPath, 'utf8'));
  };

  app.get('/', sendUiShell);

  app.get('/:asset', async (request, reply) => {
    const uiRoot = await resolveUiRoot();
    if (uiRoot === null) return reply.code(404).send({ error: 'Local UI assets are not built.' });
    const assetPath = safeRootAssetPath(uiRoot, request.url);
    if (assetPath === null) return sendUiShell(request, reply);
    try {
      return reply
        .header('cache-control', 'no-cache')
        .type(contentType(assetPath))
        .send(await readFile(assetPath));
    } catch {
      return reply.code(404).send({ error: 'Asset not found.' });
    }
  });

  app.get('/assets/*', async (request, reply) => {
    const uiRoot = await resolveUiRoot();
    if (uiRoot === null) return reply.code(404).send({ error: 'Local UI assets are not built.' });
    const assetName = path.basename(request.url);
    const assetPath = path.join(uiRoot, 'assets', assetName);
    try {
      return reply.type(contentType(assetPath)).send(await readFile(assetPath));
    } catch {
      return reply.code(404).send({ error: 'Asset not found.' });
    }
  });

  app.get('/api/health', (): LocalHealthResponse => ({
    schemaVersion: '1.0',
    status: 'ok',
    mode: 'local',
    accountRequired: false,
    cloudRequired: false,
  }));

  app.post('/api/analyze', async (request, reply) => {
    const parsed = LocalAnalyzeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid analyze request.' });
    }

    try {
      const resume = parsePlaintext(parsed.data.resumeText, 'resume');
      const job = parsePlaintext(parsed.data.jobText, 'job');
      const candidateContext = emptyCandidateContext();
      let analysis: AnalysisResult = analyzeDeterministic({ resume, job, candidateContext });

      if (repositories !== undefined) {
        try {
          const stored = await persistAnalysis(
            repositories,
            parsed.data.resumeText,
            parsed.data.jobText,
            resume,
            job,
            candidateContext,
          );
          analysis = stored.analysis;
        } catch (storageError) {
          if (storageError instanceof StorageError) {
            console.error(`[roleproof] history persistence failed (${storageError.code}).`);
          } else {
            console.error('[roleproof] history persistence failed with an unexpected error.');
          }
        }
      }

      return reply.send(LocalAnalyzeResponseSchema.parse({ schemaVersion: '1.0', analysis }));
    } catch (error) {
      if (error instanceof ParserError) {
        return reply.code(400).send({ error: 'Invalid analyze request.' });
      }
      throw error;
    }
  });

  app.post('/api/resume/parse', async (request, reply) => {
    try {
      const file = await request.file();
      if (file === undefined || file.fieldname !== 'resume') {
        return reply.code(400).send({ error: 'Invalid resume file.' });
      }

      const lowerName = file.filename.toLocaleLowerCase('en-US');
      const format = lowerName.endsWith('.pdf')
        ? ('pdf' as const)
        : lowerName.endsWith('.docx')
          ? ('docx' as const)
          : lowerName.endsWith('.txt')
            ? ('plaintext' as const)
            : null;
      if (format === null) return reply.code(400).send({ error: 'Invalid resume file.' });

      const content = await file.toBuffer();
      LocalResumeUploadMetadataSchema.parse({
        fileName: file.filename,
        format,
        byteLength: content.byteLength,
      });
      const document =
        format === 'pdf'
          ? await parsePdf(content, 'resume')
          : format === 'docx'
            ? await parseDocx(content, 'resume')
            : parsePlaintext(content, 'resume');

      return reply.send(
        LocalResumeParseResponseSchema.parse({
          schemaVersion: '1.0',
          text: document.text,
          format: document.format,
          warnings: document.warnings,
        }),
      );
    } catch (error) {
      if (error instanceof ParserError) {
        console.error(`[roleproof] resume parse failed (${error.code}): ${error.message}`);
        const failure = LocalResumeParseErrorSchema.safeParse({
          error: 'Invalid resume file.',
          code: error.code,
        });
        return reply
          .code(400)
          .send(failure.success ? failure.data : { error: 'Invalid resume file.' });
      }
      console.error('[roleproof] resume parse failed with an unexpected error.');
      return reply.code(400).send({ error: 'Invalid resume file.' });
    }
  });

  const storageUnavailable = (reply: FastifyReply) =>
    reply.code(503).send({ error: 'Local storage is not configured.' });

  const requireStorage = (reply: FastifyReply): RoleProofRepositories | undefined => {
    if (repositories === undefined) {
      storageUnavailable(reply);
      return undefined;
    }
    return repositories;
  };

  app.get('/api/history', async (request, reply) => {
    const storage = requireStorage(reply);
    if (storage === undefined) return undefined;
    const parsed = LocalHistoryQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid history query.' });

    try {
      const query = parsed.data.query?.trim() ?? '';
      const history: AnalysisHistoryItem[] =
        query.length === 0
          ? await storage.analyses.listHistory()
          : await searchHistory(storage, query);
      return reply.send(LocalHistoryListResponseSchema.parse({ schemaVersion: '1.0', history }));
    } catch (error) {
      if (error instanceof StorageError) {
        return reply.code(500).send({ error: 'History is unavailable.' });
      }
      throw error;
    }
  });

  app.get('/api/history/:id', async (request, reply) => {
    const storage = requireStorage(reply);
    if (storage === undefined) return undefined;
    const { id } = request.params as { id: string };
    if (!/^[a-z0-9-]+$/iu.test(id)) {
      return reply.code(400).send({ error: 'Invalid history identifier.' });
    }

    try {
      const stored = await storage.analyses.get(id);
      if (stored === undefined) return reply.code(404).send({ error: 'Not found.' });
      return reply.send(
        LocalAnalyzeResponseSchema.parse({ schemaVersion: '1.0', analysis: stored.result }),
      );
    } catch (error) {
      if (error instanceof StorageError) {
        return reply.code(500).send({ error: 'History is unavailable.' });
      }
      throw error;
    }
  });

  app.delete('/api/history/:id', async (request, reply) => {
    const storage = requireStorage(reply);
    if (storage === undefined) return undefined;
    const { id } = request.params as { id: string };
    if (!/^[a-z0-9-]+$/iu.test(id)) {
      return reply.code(400).send({ error: 'Invalid history identifier.' });
    }

    try {
      const removed = await storage.analyses.remove(id);
      if (!removed) return reply.code(404).send({ error: 'Not found.' });
      return reply.send({ removed: true });
    } catch (error) {
      if (error instanceof StorageError) {
        return reply.code(500).send({ error: 'History is unavailable.' });
      }
      throw error;
    }
  });

  app.get('/api/settings', async (_request, reply) => {
    const storage = requireStorage(reply);
    if (storage === undefined) return undefined;

    try {
      const settings = await storage.settings.get();
      return reply.send(
        LocalSettingsResponseSchema.parse({
          schemaVersion: '1.0',
          settings,
          databasePath: databasePath ?? 'local',
        }),
      );
    } catch (error) {
      if (error instanceof StorageError) {
        if (error.code === 'VALIDATION_FAILED') {
          return reply.code(400).send({ error: 'Invalid settings.' });
        }
        return reply.code(500).send({ error: 'Settings are unavailable.' });
      }
      throw error;
    }
  });

  app.put('/api/settings', async (request, reply) => {
    const storage = requireStorage(reply);
    if (storage === undefined) return undefined;
    const parsed = LocalSettingsPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid settings.' });

    try {
      const settings = await storage.settings.update(parsed.data);
      return reply.send(
        LocalSettingsResponseSchema.parse({
          schemaVersion: '1.0',
          settings,
          databasePath: databasePath ?? 'local',
        }),
      );
    } catch (error) {
      if (error instanceof StorageError) {
        if (error.code === 'VALIDATION_FAILED') {
          return reply.code(400).send({ error: 'Invalid settings.' });
        }
        return reply.code(500).send({ error: 'Settings are unavailable.' });
      }
      throw error;
    }
  });

  app.get('/*', async (request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found.' });
    return sendUiShell(request, reply);
  });

  return app;
}

async function searchHistory(
  storage: RoleProofRepositories,
  query: string,
): Promise<AnalysisHistoryItem[]> {
  const results = await storage.search.search(query);
  const items: AnalysisHistoryItem[] = [];
  for (const result of results) {
    if (result.entityType !== 'analysis') continue;
    const stored = await storage.analyses.get(result.id);
    if (stored !== undefined) items.push(toAnalysisHistoryItem(stored.result));
  }
  return items;
}

async function persistAnalysis(
  repositories: RoleProofRepositories,
  resumeText: string,
  jobText: string,
  resume: ParsedDocument,
  job: ParsedDocument,
  candidateContext: CandidateContext,
): Promise<{ analysis: AnalysisResult }> {
  const profile = await repositories.profiles.ensureDefault();
  const profileId = profile.id;
  const documentId = stableId('document', profileId, resume.id);
  const activeResume = { ...resume, id: documentId };
  const extractedEvidence = extractCareerEvidence(
    activeResume,
    DEFAULT_NORMALIZATION_DATA.aliases,
    { profileId },
  );
  const duplicate = await repositories.documents.insert(
    {
      schemaVersion: '1.0',
      id: documentId,
      profileId,
      kind: 'resume',
      format: 'plaintext',
      contentSha256: sha256(resumeText),
      parsedContentSha256: sha256(resume.text),
      text: resume.text,
      confidence: resume.confidence,
      warnings: resume.warnings,
    },
    extractedEvidence,
  );
  const storedResume =
    duplicate.status === 'none' ? await repositories.documents.get(documentId) : duplicate.document;
  const analysisResume = storedResume === undefined ? activeResume : parsedResume(storedResume);
  const evidence: CareerEvidence[] =
    storedResume === undefined
      ? extractedEvidence
      : await repositories.evidence.listByDocument(storedResume.id);

  const requirements = extractJobRequirements(job, DEFAULT_NORMALIZATION_DATA.aliases).requirements;
  const storedJob = await repositories.jobs.save(
    {
      schemaVersion: '1.0',
      id: job.id,
      format: 'plaintext',
      contentSha256: sha256(jobText),
      parsedContentSha256: sha256(job.text),
      text: job.text,
      confidence: job.confidence,
      warnings: job.warnings,
    },
    requirements,
  );
  const analysisJob = { ...job, id: storedJob.id };
  const analysis = analyzeDeterministicWithEvidence({
    resume: analysisResume,
    job: analysisJob,
    candidateContext,
    profileId,
    evidence,
  });
  const existing = await repositories.analyses.get(analysis.id);
  if (existing !== undefined) {
    return { analysis: existing.result };
  }
  try {
    await repositories.analyses.save(
      analysis,
      buildEvidenceReferences(analysis, evidence, profileFactEvidenceIds(candidateContext)),
      renderMarkdown(analysis),
    );
  } catch (error) {
    const raced = await repositories.analyses.get(analysis.id);
    if (raced !== undefined) return { analysis: raced.result };
    throw error;
  }
  return { analysis };
}

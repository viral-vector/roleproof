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
  EnhancedAnalysisEnvelopeSchema,
  LocalAnalyzeRequestSchema,
  LocalAnalyzeResponseSchema,
  LocalAnalyzeStreamEventSchema,
  LocalHistoryListResponseSchema,
  LocalHistoryQuerySchema,
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
  type AIEnhancement,
  type AnalysisResult,
  type CareerEvidence,
  type CandidateContext,
  type JobRequirement,
  type LocalSettings,
  type ParsedDocument,
  type ProviderConfig,
  type StoredDocument,
} from '@roleproof/shared';
import {
  buildProviderInputs,
  createProviderConfig,
  enhanceAnalysisWithFallback,
  OpenAICompatibleProvider,
  OpenAIProvider,
  ProviderError,
  providerConfigFingerprint,
  type AIProvider,
  type EnhancementFallbackResult,
  type ProviderCredentials,
} from '@roleproof/providers';
import {
  StorageError,
  toAnalysisHistoryItem,
  type AnalysisHistoryItem,
  type RoleProofRepositories,
} from '@roleproof/storage';

import {
  createDefaultProviderCredentialStore,
  providerCredentialStatus,
  resolveProviderCredential,
  type CredentialEnvironment,
  type ProviderCredentialStore,
} from './credentials.js';

export const DEFAULT_SERVE_HOST = 'localhost';
export const DEFAULT_SERVE_PORT = 4173;

export interface LocalWebAppOptions {
  repositories?: RoleProofRepositories;
  databasePath?: string;
  providerFactory?: (config: ProviderConfig) => AIProvider | Promise<AIProvider>;
  credentialStore?: ProviderCredentialStore;
  credentialEnvironment?: CredentialEnvironment;
}

export type { ProviderCredentialStore } from './credentials.js';

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
  const credentialStore = options.credentialStore ?? createDefaultProviderCredentialStore();
  const credentialEnvironment = options.credentialEnvironment ?? process.env;
  const providerFactory =
    options.providerFactory ??
    ((config: ProviderConfig) =>
      createEnvironmentProvider(config, credentialStore, credentialEnvironment));
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
      let storedAnalysis: PersistedAnalysis | undefined;

      if (repositories !== undefined) {
        try {
          storedAnalysis = await persistAnalysis(
            repositories,
            parsed.data.resumeText,
            parsed.data.jobText,
            resume,
            job,
            candidateContext,
          );
          analysis = storedAnalysis.analysis;
        } catch (storageError) {
          if (storageError instanceof StorageError) {
            console.error(`[roleproof] history persistence failed (${storageError.code}).`);
          } else {
            console.error('[roleproof] history persistence failed with an unexpected error.');
          }
        }
      }

      if (parsed.data.mode === 'ai-enhanced') {
        if (repositories === undefined) {
          return reply.code(503).send({ error: 'Local storage is not configured.' });
        }
        if (storedAnalysis === undefined) {
          return reply.code(500).send({ error: 'History is unavailable.' });
        }
        const enhanced = await enhanceStoredAnalysis(repositories, providerFactory, storedAnalysis);
        return reply.send(LocalAnalyzeResponseSchema.parse(enhanced));
      }

      return reply.send(LocalAnalyzeResponseSchema.parse({ schemaVersion: '1.0', analysis }));
    } catch (error) {
      if (error instanceof ParserError) {
        return reply.code(400).send({ error: 'Invalid analyze request.' });
      }
      if (error instanceof StorageError && error.code === 'VALIDATION_FAILED') {
        return reply.code(400).send({ error: 'Invalid provider settings.' });
      }
      throw error;
    }
  });

  app.post('/api/analyze/stream', async (request, reply) => {
    const parsed = LocalAnalyzeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid analyze request.' });
    }
    reply.header('content-type', 'application/x-ndjson; charset=utf-8');
    reply.hijack();
    const write = (event: unknown) => {
      reply.raw.write(`${JSON.stringify(LocalAnalyzeStreamEventSchema.parse(event))}\n`);
    };
    try {
      write({
        kind: 'progress',
        stage: 'parsing-resume',
        completed: 0,
        total: 4,
        message: 'Parsing resume.',
      });
      const resume = parsePlaintext(parsed.data.resumeText, 'resume');
      write({
        kind: 'progress',
        stage: 'parsing-job',
        completed: 1,
        total: 4,
        message: 'Parsing job description.',
      });
      const job = parsePlaintext(parsed.data.jobText, 'job');
      const candidateContext = emptyCandidateContext();
      write({
        kind: 'progress',
        stage: 'baseline-analysis',
        completed: 2,
        total: 4,
        message: 'Running baseline analysis.',
      });
      let analysis: AnalysisResult = analyzeDeterministic({ resume, job, candidateContext });
      let storedAnalysis: PersistedAnalysis | undefined;
      let enhancementResult: Awaited<ReturnType<typeof enhanceAnalysisWithFallback>> | undefined;
      if (repositories !== undefined) {
        try {
          storedAnalysis = await persistAnalysis(
            repositories,
            parsed.data.resumeText,
            parsed.data.jobText,
            resume,
            job,
            candidateContext,
          );
          analysis = storedAnalysis.analysis;
        } catch (storageError) {
          if (storageError instanceof StorageError) {
            console.error(`[roleproof] history persistence failed (${storageError.code}).`);
          } else {
            console.error('[roleproof] history persistence failed with an unexpected error.');
          }
        }
      }

      if (parsed.data.mode === 'ai-enhanced') {
        if (repositories === undefined || storedAnalysis === undefined) {
          write({ kind: 'result', response: { schemaVersion: '1.0', analysis } });
          reply.raw.end();
          return;
        }
        const settings = await repositories.settings.get();
        const config = configFromSettings(settings);
        const inputs = buildProviderInputs(
          storedAnalysis.analysis,
          storedAnalysis.requirements,
          storedAnalysis.evidence,
        );
        write({
          kind: 'progress',
          stage: 'provider-requirements',
          completed: 3,
          total: 4,
          message: 'Interpreting requirements.',
        });
        const provider = await providerFactory(config);
        const fingerprint = providerConfigFingerprint(config);
        const startedAt = new Date().toISOString();
        enhancementResult = await enhanceAnalysisWithFallback(
          storedAnalysis.analysis,
          provider,
          inputs.requirementAnalysis,
          inputs.evidenceMapping,
          inputs.applicationSuggestions,
          [],
        );
        write({
          kind: 'progress',
          stage: 'provider-evidence',
          completed: 4,
          total: 4,
          message: 'Mapping evidence.',
        });
        write({
          kind: 'progress',
          stage: 'provider-suggestions',
          completed: 4,
          total: 4,
          message: 'Preparing suggestions.',
        });
        write({
          kind: 'progress',
          stage: 'complete',
          completed: 4,
          total: 4,
          message: 'Analysis complete.',
        });
        if (enhancementResult.enhancement !== undefined) {
          const enhancement = await saveEnhancement(
            repositories,
            enhancementResult.enhancement,
            fingerprint,
          );
          write({
            kind: 'result',
            response: {
              schemaVersion: '2.0',
              analysis: storedAnalysis.analysis,
              aiEnhancement: enhancement,
            },
          });
        } else {
          await recordProviderFailure(
            repositories,
            storedAnalysis.analysis.id,
            config,
            provider,
            enhancementResult,
            startedAt,
          );
          write({ kind: 'result', response: { schemaVersion: '1.0', analysis } });
        }
        reply.raw.end();
        return;
      }

      write({
        kind: 'progress',
        stage: 'complete',
        completed: 4,
        total: 4,
        message: 'Analysis complete.',
      });
      write({ kind: 'result', response: { schemaVersion: '1.0', analysis } });
      reply.raw.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analysis failed.';
      write({ kind: 'error', error: message });
      reply.raw.end();
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
      const enhancement = await storage.aiEnhancements.get(id);
      if (enhancement !== undefined) {
        return reply.send(
          LocalAnalyzeResponseSchema.parse(
            EnhancedAnalysisEnvelopeSchema.parse({
              schemaVersion: '2.0',
              analysis: stored.result,
              aiEnhancement: enhancement.enhancement,
            }),
          ),
        );
      }
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
      const settings = defaultLocalAiSettings(await storage.settings.get());
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
      const settings = defaultLocalAiSettings(await storage.settings.update(parsed.data));
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

  app.get('/api/provider-credentials', async (_request, reply) => {
    try {
      return reply.send(
        LocalProviderCredentialStatusResponseSchema.parse({
          schemaVersion: '1.0',
          credentials: await providerCredentialStatus(credentialStore, credentialEnvironment),
        }),
      );
    } catch {
      return reply.code(500).send({ error: 'Provider credentials are unavailable.' });
    }
  });

  app.put('/api/provider-credentials', async (request, reply) => {
    const parsed = LocalProviderCredentialSaveRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid provider credential.' });
    try {
      await credentialStore.set(parsed.data.provider, parsed.data.apiKey);
      return reply.send(
        LocalProviderCredentialStatusResponseSchema.parse({
          schemaVersion: '1.0',
          credentials: await providerCredentialStatus(credentialStore, credentialEnvironment),
        }),
      );
    } catch {
      return reply.code(500).send({ error: 'Provider credential could not be saved.' });
    }
  });

  app.delete('/api/provider-credentials/:provider', async (request, reply) => {
    const provider = LocalProviderCredentialProviderSchema.safeParse(
      (request.params as { provider: string }).provider,
    );
    if (!provider.success) return reply.code(400).send({ error: 'Invalid provider credential.' });
    try {
      return reply.send(
        LocalProviderCredentialDeleteResponseSchema.parse({
          removed: await credentialStore.delete(provider.data),
        }),
      );
    } catch {
      return reply.code(500).send({ error: 'Provider credential could not be removed.' });
    }
  });

  app.get('/api/provider-models', async (request, reply) => {
    const parsed = LocalProviderModelsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid provider model request.' });
    let settings: LocalSettings = {};
    if (repositories !== undefined) {
      try {
        settings = defaultLocalAiSettings(await repositories.settings.get());
      } catch (error) {
        if (error instanceof StorageError) {
          return reply.code(500).send({ error: 'Provider models are unavailable.' });
        }
        throw error;
      }
    }
    try {
      const provider = await providerFactory(configFromModelQuery(settings, parsed.data));
      const result = await provider.listModels();
      return reply.send(
        LocalProviderModelsResponseSchema.parse({
          schemaVersion: '1.0',
          models: result.output.models,
        }),
      );
    } catch (error) {
      if (error instanceof ProviderError) {
        return reply.code(400).send({ error: 'Provider models are unavailable.' });
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

interface PersistedAnalysis {
  analysis: AnalysisResult;
  requirements: JobRequirement[];
  evidence: CareerEvidence[];
}

function microUsd(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value * 1_000_000);
}

function providerRates(settings: LocalSettings): ProviderConfig['rates'] {
  if (
    settings.inputMicroUsdPerMillionTokens == null ||
    settings.outputMicroUsdPerMillionTokens == null
  ) {
    return null;
  }
  return {
    inputMicroUsdPerMillionTokens: settings.inputMicroUsdPerMillionTokens,
    outputMicroUsdPerMillionTokens: settings.outputMicroUsdPerMillionTokens,
  };
}

function configFromSettings(settings: LocalSettings): ProviderConfig {
  if (settings.provider == null || settings.model == null) {
    throw new ProviderError('configuration', 'health-check');
  }
  const destination =
    settings.destination ??
    (settings.provider === 'openai' ? ('hosted' as const) : ('local' as const));
  return createProviderConfig({
    provider: settings.provider,
    model: settings.model,
    destination,
    baseUrl: settings.baseUrl ?? null,
    maxCostMicroUsd: microUsd(settings.maxCostUsd),
    rates: providerRates(settings),
    redaction: {
      confidentialEmployerNames: settings.redactEmployer ?? false,
      clearanceDetails: settings.redactClearance ?? false,
      userSelectedTerms: settings.redactionTerms ?? [],
    },
    ...(settings.providerTimeoutMs == null ? {} : { requestTimeoutMs: settings.providerTimeoutMs }),
    ...(settings.maxTotalTokens == null ? {} : { maxTotalTokens: settings.maxTotalTokens }),
    ...(settings.structuredOutputMode == null
      ? {}
      : { structuredOutputMode: settings.structuredOutputMode }),
  });
}

function defaultLocalAiSettings(settings: LocalSettings): LocalSettings {
  if (settings.provider != null || settings.model != null || settings.baseUrl != null) return settings;
  return {
    ...settings,
    provider: 'openai-compatible',
    model: 'phi4-mini:latest',
    destination: 'local',
    baseUrl: 'http://localhost:11434/v1',
    structuredOutputMode: 'json-schema',
  };
}

function configFromModelQuery(
  settings: LocalSettings,
  query: ReturnType<typeof LocalProviderModelsQuerySchema.parse>,
): ProviderConfig {
  return configFromSettings({
    ...settings,
    provider: query.provider,
    model: query.model ?? settings.model ?? 'model-list-probe',
    destination:
      query.destination ??
      settings.destination ??
      (query.provider === 'openai' ? ('hosted' as const) : ('local' as const)),
    baseUrl: query.baseUrl ?? settings.baseUrl ?? null,
  });
}

async function createEnvironmentProvider(
  config: ProviderConfig,
  credentialStore: ProviderCredentialStore,
  credentialEnvironment: CredentialEnvironment,
): Promise<AIProvider> {
  if (config.provider === 'openai') {
    const credentials: ProviderCredentials = {
      apiKey:
        (await resolveProviderCredential('openai', credentialStore, credentialEnvironment)) ?? '',
    };
    return new OpenAIProvider(config, credentials);
  }
  const credentials =
    config.destination === 'local'
      ? null
      : ({
          apiKey:
            (await resolveProviderCredential(
              'openai-compatible',
              credentialStore,
              credentialEnvironment,
            )) ?? '',
        } satisfies ProviderCredentials);
  return new OpenAICompatibleProvider(config, credentials);
}

async function saveEnhancement(
  repositories: RoleProofRepositories,
  enhancement: AIEnhancement,
  fingerprint: string,
): Promise<AIEnhancement> {
  try {
    await repositories.aiEnhancements.save(enhancement, fingerprint);
    return enhancement;
  } catch (error) {
    const existing = await repositories.aiEnhancements.get(enhancement.baselineAnalysisId);
    if (existing !== undefined && existing.configFingerprint === fingerprint) {
      return existing.enhancement;
    }
    throw error;
  }
}

async function recordProviderFailure(
  repositories: RoleProofRepositories,
  baselineAnalysisId: string,
  config: ProviderConfig,
  provider: AIProvider,
  result: EnhancementFallbackResult,
  startedAt: string,
): Promise<void> {
  const operation = result.error?.operation ?? 'analyze-requirements';
  const code = result.error?.code ?? 'configuration';
  console.error(`[roleproof] provider enhancement failed (${code}) during ${operation}.`);
  await repositories.providerCalls.recordFailure({
    baselineAnalysisId,
    provider: config.provider,
    model: config.model,
    operation,
    destination: config.destination,
    endpointOrigin: provider.endpointOrigin,
    errorCode: code,
    manifest: result.failureManifest ?? null,
    completedExecutions:
      result.completedExecutions === undefined ? undefined : [...result.completedExecutions],
    failedExecution: result.failedExecution,
    requestId: null,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: 0,
  });
}

async function enhanceStoredAnalysis(
  repositories: RoleProofRepositories,
  providerFactory: (config: ProviderConfig) => AIProvider | Promise<AIProvider>,
  stored: PersistedAnalysis,
): Promise<unknown> {
  const settings = await repositories.settings.get();
  let config: ProviderConfig;
  let provider: AIProvider;
  try {
    config = configFromSettings(settings);
    provider = await providerFactory(config);
  } catch (error) {
    if (error instanceof ProviderError) {
      throw new StorageError('VALIDATION_FAILED', 'Invalid provider settings', { cause: error });
    }
    throw error;
  }
  const fingerprint = providerConfigFingerprint(config);
  const existing = await repositories.aiEnhancements.get(stored.analysis.id);
  if (existing !== undefined) {
    if (existing.configFingerprint !== fingerprint) {
      throw new StorageError('VALIDATION_FAILED', 'AI enhancement configuration has changed');
    }
    return EnhancedAnalysisEnvelopeSchema.parse({
      schemaVersion: '2.0',
      analysis: stored.analysis,
      aiEnhancement: existing.enhancement,
    });
  }

  const inputs = buildProviderInputs(stored.analysis, stored.requirements, stored.evidence);
  const startedAt = new Date().toISOString();
  const result = await enhanceAnalysisWithFallback(
    stored.analysis,
    provider,
    inputs.requirementAnalysis,
    inputs.evidenceMapping,
    inputs.applicationSuggestions,
  );
  if (result.enhancement !== undefined) {
    const enhancement = await saveEnhancement(repositories, result.enhancement, fingerprint);
    return EnhancedAnalysisEnvelopeSchema.parse({
      schemaVersion: '2.0',
      analysis: stored.analysis,
      aiEnhancement: enhancement,
    });
  }

  await recordProviderFailure(repositories, stored.analysis.id, config, provider, result, startedAt);
  return { schemaVersion: '1.0' as const, analysis: stored.analysis };
}

async function persistAnalysis(
  repositories: RoleProofRepositories,
  resumeText: string,
  jobText: string,
  resume: ParsedDocument,
  job: ParsedDocument,
  candidateContext: CandidateContext,
): Promise<PersistedAnalysis> {
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
    return { analysis: existing.result, requirements, evidence };
  }
  try {
    await repositories.analyses.save(
      analysis,
      buildEvidenceReferences(analysis, evidence, profileFactEvidenceIds(candidateContext)),
      renderMarkdown(analysis),
    );
  } catch (error) {
    const raced = await repositories.analyses.get(analysis.id);
    if (raced !== undefined) return { analysis: raced.result, requirements, evidence };
    throw error;
  }
  return { analysis, requirements, evidence };
}

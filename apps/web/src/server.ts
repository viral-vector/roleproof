import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { analyzeDeterministic } from '@roleproof/core';
import {
  DEFAULT_PARSER_CONFIG,
  ParserError,
  parseDocx,
  parsePdf,
  parsePlaintext,
} from '@roleproof/parsers';
import {
  CandidateContextSchema,
  LocalAnalyzeRequestSchema,
  LocalAnalyzeResponseSchema,
  LocalResumeParseErrorSchema,
  LocalResumeParseResponseSchema,
  LocalResumeUploadMetadataSchema,
} from '@roleproof/shared';

export const DEFAULT_SERVE_HOST = 'localhost';
export const DEFAULT_SERVE_PORT = 4173;

export interface LocalHealthResponse {
  schemaVersion: '1.0';
  status: 'ok';
  mode: 'local';
  accountRequired: false;
  cloudRequired: false;
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

export function createLocalWebApp(): FastifyInstance {
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

  app.post('/api/analyze', (request, reply) => {
    const parsed = LocalAnalyzeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid analyze request.' });
    }

    try {
      const resume = parsePlaintext(parsed.data.resumeText, 'resume');
      const job = parsePlaintext(parsed.data.jobText, 'job');
      const analysis = analyzeDeterministic({
        resume,
        job,
        candidateContext: CandidateContextSchema.parse({
          preferredLocations: [],
          clearances: [],
          licenses: [],
          education: [],
          certifications: [],
        }),
      });

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

  app.get('/*', async (request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found.' });
    return sendUiShell(request, reply);
  });

  return app;
}

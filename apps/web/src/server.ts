import Fastify, { type FastifyInstance } from 'fastify';

export const DEFAULT_SERVE_HOST = 'localhost';
export const DEFAULT_SERVE_PORT = 4173;

export interface LocalHealthResponse {
  schemaVersion: '1.0';
  status: 'ok';
  mode: 'local';
  accountRequired: false;
  cloudRequired: false;
}

export function createLocalWebApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/api/health', (): LocalHealthResponse => ({
    schemaVersion: '1.0',
    status: 'ok',
    mode: 'local',
    accountRequired: false,
    cloudRequired: false,
  }));

  return app;
}

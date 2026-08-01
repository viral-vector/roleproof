import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const cliEntryPath = fileURLToPath(new URL('../bin/roleproof.js', import.meta.url));

interface StartedServer {
  child: ChildProcess;
  port: number;
}

function waitForUrlLine(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('roleproof serve did not announce its URL in time.'));
    }, 20_000);
    child.stderr?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const match = /http:\/\/127\.0\.0\.1:(\d+)/u.exec(buffer);
      if (match !== null) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
  });
}

async function startServer(databasePath: string): Promise<StartedServer> {
  const child = spawn(
    process.execPath,
    [cliEntryPath, 'serve', '--host', '127.0.0.1', '--port', '0', '--db', databasePath],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  const port = await waitForUrlLine(child);
  return { child, port };
}

async function stopServer(server: StartedServer): Promise<void> {
  server.child.kill();
  await new Promise<void>((resolve) => server.child.once('exit', () => resolve()));
}

describe('built roleproof serve executable', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'roleproof serve-'));
  });

  afterAll(async () => {
    await rm(directory, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 });
  });

  it('serves history and settings backed by the local database', async () => {
    const databasePath = join(directory, 'serve.db');
    const server = await startServer(databasePath);

    try {
      const history = await fetch(`http://127.0.0.1:${String(server.port)}/api/history`);
      expect(history.status).toBe(200);
      await expect(history.json()).resolves.toEqual({ schemaVersion: '1.0', history: [] });

      const settings = await fetch(`http://127.0.0.1:${String(server.port)}/api/settings`);
      expect(settings.status).toBe(200);
      await expect(settings.json()).resolves.toEqual({
        schemaVersion: '1.0',
        settings: {},
        databasePath,
      });
    } finally {
      await stopServer(server);
    }
  });
});

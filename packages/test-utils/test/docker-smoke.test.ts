import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, test } from 'vitest';

function runSmokeWithFakeDocker(fakeDockerPath: string): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const scriptUrl = pathToFileURL(join(process.cwd(), 'scripts', 'docker-smoke.mjs')).href;
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `process.umask(0o077); await import(${JSON.stringify(scriptUrl)});`,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, ROLEPROOF_DOCKER: fakeDockerPath },
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code: signal === null ? (code ?? 1) : 1, stdout, stderr });
    });
  });
}

const testOnPosix = process.platform === 'win32' ? test.skip : test;

describe('docker smoke script', () => {
  testOnPosix(
    'creates mounted fixture files readable by the container user under a restrictive umask',
    async () => {
      const temporaryDirectory = await mkdtemp(join(tmpdir(), 'roleproof-fake-docker-'));
      const fakeDockerScript = join(temporaryDirectory, 'fake-docker.mjs');
      const fakeDockerCommand = join(temporaryDirectory, 'fake-docker');
      const fakeDockerSource = `#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args[0] === 'version') {
  process.stdout.write('24.0.0\\n');
  process.exit(0);
}
if (args[0] === 'build') process.exit(0);
if (args[0] === 'run') {
  const mount = args[args.indexOf('-v') + 1];
  const suffix = ':/work:ro';
  if (typeof mount !== 'string' || !mount.endsWith(suffix)) {
    process.stderr.write('missing smoke mount\\n');
    process.exit(64);
  }
  const mountDirectory = mount.slice(0, -suffix.length);
  const directory = await stat(mountDirectory);
  if ((directory.mode & 0o005) !== 0o005) {
    process.stderr.write('mount directory is not world-readable and searchable\\n');
    process.exit(13);
  }
  for (const fileName of ['resume.txt', 'job.txt']) {
    const file = await stat(join(mountDirectory, fileName));
    if ((file.mode & 0o004) !== 0o004) {
      process.stderr.write(fileName + ' is not world-readable\\n');
      process.exit(13);
    }
  }
  process.stdout.write(JSON.stringify({ schemaVersion: '1.0', analysis: { recommendation: 'apply' } }));
  process.exit(0);
}
process.stderr.write('unexpected docker arguments: ' + args.join(' ') + '\\n');
process.exit(64);
`;

      try {
        await writeFile(fakeDockerScript, fakeDockerSource, 'utf8');
        await writeFile(
          fakeDockerCommand,
          `#!/bin/sh\nexec ${process.execPath} ${fakeDockerScript} "$@"\n`,
          {
            encoding: 'utf8',
            mode: 0o755,
          },
        );
        await chmod(fakeDockerCommand, 0o755);

        const result = await runSmokeWithFakeDocker(fakeDockerCommand);

        expect(result.stderr).toBe('');
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('docker smoke passed');
      } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    },
  );
});

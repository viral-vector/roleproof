import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IMAGE = process.env.ROLEPROOF_DOCKER_IMAGE ?? 'roleproof:smoke';

function run(executable, args, options = {}, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code: signal === null ? (code ?? 1) : 1, stdout, stderr });
    });
    if (input !== undefined) {
      child.stdin?.write(input);
      child.stdin?.end();
    }
  });
}

async function main() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'roleproof-docker-'));
  const resumePath = join(temporaryDirectory, 'resume.txt');
  const jobPath = join(temporaryDirectory, 'job.txt');
  const resumeText =
    'Fictional Candidate\nSkills: TypeScript, Node.js, PostgreSQL\n2020-2026: Built backend REST APIs with TypeScript and Node.js.\n';
  const jobText = 'Backend Engineer\nRequired: TypeScript, Node.js, PostgreSQL\n';
  await writeFile(resumePath, resumeText, 'utf8');
  await writeFile(jobPath, jobText, 'utf8');
  // CI may use a restrictive umask, while the container runs as the
  // unprivileged node user rather than the runner user.
  await chmod(temporaryDirectory, 0o755);
  await chmod(resumePath, 0o644);
  await chmod(jobPath, 0o644);

  try {
    const docker = process.env.ROLEPROOF_DOCKER ?? 'docker';
    const availability = await run(docker, ['version', '--format', '{{.Server.Version}}']);
    if (availability.code !== 0) {
      process.stderr.write(
        'docker smoke failed: Docker is not available. Start Docker Desktop and try again.\n',
      );
      return 1;
    }

    const buildResult = await run(docker, ['build', '-t', IMAGE, '--progress', 'plain', '.'], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (buildResult.code !== 0) {
      process.stderr.write('docker smoke failed: image build exited with a non-zero status.\n');
      return 1;
    }

    const mount = `${temporaryDirectory}:/work:ro`;
    const fileResult = await run(docker, [
      'run',
      '--rm',
      '-v',
      mount,
      IMAGE,
      'analyze',
      '--resume',
      '/work/resume.txt',
      '--job',
      '/work/job.txt',
      '--no-ai',
      '--no-store',
      '--format',
      'json',
      '--stdout',
    ]);
    if (fileResult.code !== 0) {
      process.stderr.write(
        `docker smoke failed: container analyze exited with a non-zero status.\n${fileResult.stderr}\n`,
      );
      return 1;
    }
    try {
      const envelope = JSON.parse(fileResult.stdout);
      if (
        envelope.schemaVersion !== '1.0' ||
        typeof envelope.analysis?.recommendation !== 'string'
      ) {
        process.stderr.write(
          'docker smoke failed: container JSON did not match the analysis envelope.\n',
        );
        return 1;
      }
    } catch {
      process.stderr.write('docker smoke failed: container stdout was not valid JSON.\n');
      return 1;
    }

    const stdinResult = await run(
      docker,
      [
        'run',
        '--rm',
        '-i',
        '-v',
        mount,
        IMAGE,
        'analyze',
        '--resume',
        '/work/resume.txt',
        '--stdin-job',
        '--no-ai',
        '--no-store',
        '--format',
        'json',
        '--stdout',
      ],
      {},
      jobText,
    );
    if (stdinResult.code !== 0) {
      process.stderr.write(
        `docker smoke failed: piped container analyze exited with a non-zero status.\n${stdinResult.stderr}\n`,
      );
      return 1;
    }
    try {
      const envelope = JSON.parse(stdinResult.stdout);
      if (envelope.schemaVersion !== '1.0') {
        process.stderr.write(
          'docker smoke failed: piped container stdout was not a valid analysis envelope.\n',
        );
        return 1;
      }
    } catch {
      process.stderr.write('docker smoke failed: piped container stdout was not valid JSON.\n');
      return 1;
    }

    process.stdout.write(
      `docker smoke passed: ${IMAGE} built, file analysis and piped stdin analysis both valid.\n`,
    );
    return 0;
  } finally {
    await rm(temporaryDirectory, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 });
  }
}

process.exitCode = await main();

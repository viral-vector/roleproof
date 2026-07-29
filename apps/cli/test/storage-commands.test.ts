import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { closeStorage, createRoleProofRepositories, openStorage } from '@roleproof/storage';
import { AnalysisResultSchema, CommandEnvelopeSchema } from '@roleproof/shared';

import { runCli } from '../src/program.js';

const directories: string[] = [];

async function temporaryDatabase(): Promise<{ databasePath: string; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'roleproof cli storage path with spaces-'));
  directories.push(directory);
  return { databasePath: resolve(directory, 'role proof.db'), directory };
}

async function invoke(args: string[]) {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli(args, {
    writeOut(message) {
      stdout += message;
    },
    writeErr(message) {
      stderr += message;
    },
  });
  return { exitCode, stderr, stdout };
}

function json(stdout: string): {
  schemaVersion: '1.0';
  command: string;
  data: Record<string, unknown>;
} {
  return CommandEnvelopeSchema.parse(JSON.parse(stdout) as unknown) as unknown as {
    schemaVersion: '1.0';
    command: string;
    data: Record<string, unknown>;
  };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) =>
        rm(directory, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 }),
      ),
  );
});

describe('RoleProof Phase 2 storage commands', () => {
  it('initializes storage and ensures profile-local with pure JSON output', async () => {
    const { databasePath } = await temporaryDatabase();
    const result = await invoke(['--db', databasePath, 'init', '--format', 'json']);

    expect(result).toMatchObject({ exitCode: 0, stderr: '' });
    expect(json(result.stdout)).toMatchObject({
      schemaVersion: '1.0',
      command: 'init',
      data: { profile: { id: 'profile-local', targetTitles: [], preferredLocations: [] } },
    });
    await expect(access(databasePath)).resolves.toBeUndefined();
  });

  it('creates and shows profiles with their documents and evidence', async () => {
    const { databasePath } = await temporaryDatabase();
    const created = await invoke([
      '--db',
      databasePath,
      'profile',
      'create',
      '--name',
      'Avery Example',
      '--format',
      'json',
    ]);
    const profile = json(created.stdout).data.profile as { id: string };
    const shown = await invoke([
      '--db',
      databasePath,
      'profile',
      'show',
      '--profile',
      profile.id,
      '--format',
      'json',
    ]);

    expect(created).toMatchObject({ exitCode: 0, stderr: '' });
    expect(json(shown.stdout)).toMatchObject({
      command: 'profile.show',
      data: { profile: { name: 'Avery Example' }, documents: [], evidence: [] },
    });
  });

  it('adds resume and manual evidence, then edits and removes evidence', async () => {
    const { databasePath, directory } = await temporaryDatabase();
    const resumePath = join(directory, 'fictional resume with spaces.txt');
    await writeFile(resumePath, 'Skills: TypeScript\nBuilt services using TypeScript.', 'utf8');
    await invoke(['--db', databasePath, 'init']);

    const imported = await invoke([
      '--db',
      databasePath,
      'profile',
      'evidence',
      'add',
      '--profile',
      'profile-local',
      '--resume',
      resumePath,
      '--format',
      'json',
    ]);
    expect(imported).toMatchObject({ exitCode: 0, stderr: '' });
    expect(json(imported.stdout).data).toMatchObject({ status: 'imported' });
    expect((json(imported.stdout).data.evidence as unknown[]).length).toBeGreaterThan(0);

    const added = await invoke([
      '--db',
      databasePath,
      'profile',
      'evidence',
      'add',
      '--profile',
      'profile-local',
      '--category',
      'project',
      '--name',
      'Fictional migration',
      '--description',
      'Delivered a fictional migration.',
      '--format',
      'json',
    ]);
    const evidence = json(added.stdout).data.evidence as { id: string; confidence: string };
    expect(evidence.confidence).toBe('user-confirmed');

    const edited = await invoke([
      '--db',
      databasePath,
      'profile',
      'evidence',
      'edit',
      '--evidence',
      evidence.id,
      '--description',
      'Updated fictional migration.',
      '--format',
      'json',
    ]);
    expect(json(edited.stdout).data).toMatchObject({
      evidence: { description: 'Updated fictional migration.' },
    });

    const removed = await invoke([
      '--db',
      databasePath,
      'profile',
      'evidence',
      'remove',
      '--evidence',
      evidence.id,
      '--format',
      'json',
    ]);
    expect(json(removed.stdout).data).toEqual({ evidenceId: evidence.id, removed: true });
  });

  it('canonicalizes manual evidence through version-controlled skill aliases', async () => {
    const { databasePath } = await temporaryDatabase();
    await invoke(['--db', databasePath, 'init']);

    const added = await invoke([
      '--db',
      databasePath,
      'profile',
      'evidence',
      'add',
      '--profile',
      'profile-local',
      '--category',
      'skill',
      '--name',
      'K8s',
      '--description',
      'Used K8s in a fictional project.',
      '--format',
      'json',
    ]);

    expect(json(added.stdout).data).toMatchObject({
      evidence: { name: 'K8s', normalizedName: 'Kubernetes', confidence: 'user-confirmed' },
    });
  });

  it('shows stored history/reports and searches repository-seeded data', async () => {
    const { databasePath } = await temporaryDatabase();
    const database = await openStorage({ path: databasePath });
    try {
      const repositories = createRoleProofRepositories(database);
      await repositories.profiles.ensureDefault();
      const result = AnalysisResultSchema.parse({
        schemaVersion: '1.0',
        id: 'analysis-1',
        profileId: 'profile-local',
        overallScore: 75,
        recommendation: 'stretch',
        confidence: 0.9,
        hardBlockers: [],
        matchedRequirements: [],
        missingRequirements: [],
        unsupportedClaims: [],
        suggestedEmphasis: [],
        suggestedAdditions: [],
        interviewTopics: ['Discuss fictional TypeScript work'],
        generatedAt: '2026-01-01T00:00:00.000Z',
        metadata: { mode: 'deterministic', engineVersion: 'test' },
      });
      await repositories.analyses.save(
        result,
        [],
        '# Stored report\n\nFictional TypeScript report.',
      );
    } finally {
      await closeStorage(database);
    }

    const history = await invoke([
      '--db',
      databasePath,
      'history',
      '--profile',
      'profile-local',
      '--format',
      'json',
    ]);
    const reportJson = await invoke([
      '--db',
      databasePath,
      'report',
      'show',
      '--analysis',
      'analysis-1',
      '--format',
      'json',
    ]);
    const reportMarkdown = await invoke([
      '--db',
      databasePath,
      'report',
      'show',
      '--analysis',
      'analysis-1',
    ]);
    const search = await invoke([
      '--db',
      databasePath,
      'search',
      '--query',
      'TypeScript',
      '--format',
      'json',
    ]);

    expect(json(history.stdout).data.history).toHaveLength(1);
    expect(json(reportJson.stdout).data).toMatchObject({ analysis: { id: 'analysis-1' } });
    expect(reportMarkdown.stdout).toContain('# Stored report');
    expect(json(search.stdout).data.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'analysis-1' })]),
    );
  });

  it('requires purge confirmation and removes all SQLite files without opening storage', async () => {
    const { databasePath } = await temporaryDatabase();
    const declined = await invoke(['--db', databasePath, 'data', 'purge', '--format', 'json']);
    expect(declined).toMatchObject({ exitCode: 2, stdout: '' });
    await expect(access(databasePath)).rejects.toMatchObject({ code: 'ENOENT' });

    await invoke(['--db', databasePath, 'init']);
    const purged = await invoke([
      '--db',
      databasePath,
      'data',
      'purge',
      '--yes',
      '--format',
      'json',
    ]);
    expect(purged).toMatchObject({ exitCode: 0, stderr: '' });
    expect(json(purged.stdout).data).toMatchObject({ databaseRemoved: true });
    await expect(access(databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(`${databasePath}-wal`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(`${databasePath}-shm`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('maps invalid arguments/missing IDs to 2 and storage failures to content-free exit 5', async () => {
    const { databasePath, directory } = await temporaryDatabase();
    const privateText = 'PRIVATE-FULL-DOCUMENT-CONTENT';
    const missing = await invoke(['--db', databasePath, 'profile', 'show', '--profile', 'missing']);
    const invalid = await invoke(['--db', databasePath, 'search']);
    const storageFailure = await invoke(['--db', directory, 'init']);

    expect(missing).toMatchObject({ exitCode: 2, stdout: '' });
    expect(invalid).toMatchObject({ exitCode: 2, stdout: '' });
    expect(storageFailure).toMatchObject({ exitCode: 5, stdout: '' });
    expect(storageFailure.stderr).not.toContain(privateText);
    expect(storageFailure.stderr).not.toContain(' at ');
  });
});

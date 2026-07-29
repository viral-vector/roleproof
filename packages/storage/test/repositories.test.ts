import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CandidateProfileSchema,
  CareerEvidenceSchema,
  DuplicateDocumentResultSchema,
  StoredDocumentSchema,
} from '@roleproof/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  closeStorage,
  createRoleProofRepositories,
  openStorage,
  StorageError,
  type StorageDatabase,
} from '../src/index.js';

const temporaryDirectories: string[] = [];
const databases: StorageDatabase[] = [];
const firstTimestamp = '2026-04-01T10:00:00.000Z';
const secondTimestamp = '2026-04-02T10:00:00.000Z';

async function openTemporaryStorage(): Promise<StorageDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'roleproof-repositories-'));
  temporaryDirectories.push(directory);
  const database = await openStorage({ path: join(directory, 'roleproof.db') });
  databases.push(database);
  return database;
}

function fixedClock(timestamp = firstTimestamp): () => Date {
  return () => new Date(timestamp);
}

function profile(id: string, name?: string) {
  return {
    id,
    ...(name === undefined ? {} : { name }),
    targetTitles: ['Platform Engineer'],
    preferredLocations: ['Remote'],
    remotePreference: 'remote' as const,
    targetSalaryMin: 100_000,
    targetSalaryMax: 140_000,
    workAuthorization: 'Fictional authorization',
  };
}

function document(
  id: string,
  profileId: string,
  contentCharacter: string,
  parsedCharacter: string,
  kind: 'resume' | 'evidence-note' = 'resume',
) {
  return {
    schemaVersion: '1.0' as const,
    id,
    profileId,
    kind,
    format: 'plaintext' as const,
    originalName: kind === 'resume' ? `${id}.txt` : `${id}.md`,
    contentSha256: contentCharacter.repeat(64),
    parsedContentSha256: parsedCharacter.repeat(64),
    text: kind === 'resume' ? 'Built fictional observability services.' : 'User evidence note.',
    confidence: 1,
    warnings: [],
  };
}

function evidence(id: string, profileId: string, sourceDocumentId: string) {
  return {
    id,
    profileId,
    category: 'skill' as const,
    name: 'Observability',
    normalizedName: 'observability',
    description: 'Built fictional observability services.',
    employer: 'Example Works',
    project: 'Cobalt Service',
    startDate: '2024-01',
    endDate: '2025-01',
    sourceDocumentId,
    sourceText: 'Built fictional observability services.',
    confidence: 'explicit' as const,
  };
}

afterEach(async () => {
  await Promise.allSettled(databases.splice(0).map((database) => closeStorage(database)));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('profile repository', () => {
  it('ensures the reserved local profile and returns schema values in stable id order', async () => {
    const database = await openTemporaryStorage();
    const { profiles } = createRoleProofRepositories(database, fixedClock());

    const local = await profiles.ensureDefault();
    await profiles.create(profile('profile-z', 'Zed Example'));
    await profiles.create(profile('profile-a'));

    expect(local).toEqual({
      id: 'profile-local',
      targetTitles: [],
      preferredLocations: [],
      createdAt: firstTimestamp,
      updatedAt: firstTimestamp,
    });
    expect(CandidateProfileSchema.parse(local)).toEqual(local);
    expect((await profiles.list()).map(({ id }) => id)).toEqual([
      'profile-a',
      'profile-local',
      'profile-z',
    ]);
    expect(await profiles.ensureDefault()).toEqual(local);
  });

  it('round-trips optional profile fields, JSON arrays, and timestamped updates', async () => {
    const database = await openTemporaryStorage();
    const timestamps = [firstTimestamp, secondTimestamp];
    const { profiles } = createRoleProofRepositories(
      database,
      () => new Date(timestamps.shift() ?? secondTimestamp),
    );

    const created = await profiles.create(profile('profile-1', 'Avery Example'));
    const updated = await profiles.update('profile-1', {
      name: undefined,
      targetTitles: ['Staff Engineer', 'Platform Lead'],
      preferredLocations: [],
      remotePreference: 'any',
      targetSalaryMin: undefined,
      targetSalaryMax: undefined,
      workAuthorization: undefined,
    });

    expect(CandidateProfileSchema.parse(created)).toEqual(created);
    expect(updated).toEqual({
      id: 'profile-1',
      targetTitles: ['Staff Engineer', 'Platform Lead'],
      preferredLocations: [],
      remotePreference: 'any',
      createdAt: firstTimestamp,
      updatedAt: secondTimestamp,
    });
    expect(await profiles.get('profile-1')).toEqual(updated);
  });
});

describe('document repository', () => {
  it('distinguishes exact and same-parsed-content duplicates within a profile', async () => {
    const database = await openTemporaryStorage();
    const repositories = createRoleProofRepositories(database, fixedClock());
    await repositories.profiles.create(profile('profile-1'));
    await repositories.profiles.create(profile('profile-2'));
    const original = document('document-1', 'profile-1', 'a', 'b');
    expect(
      await repositories.documents.insert(original, [
        evidence('evidence-1', 'profile-1', 'document-1'),
      ]),
    ).toEqual({ status: 'none' });

    const exact = await repositories.documents.findDuplicate(
      'profile-1',
      'a'.repeat(64),
      'c'.repeat(64),
    );
    const sameParsed = await repositories.documents.findDuplicate(
      'profile-1',
      'c'.repeat(64),
      'b'.repeat(64),
    );
    const otherProfile = await repositories.documents.findDuplicate(
      'profile-2',
      'a'.repeat(64),
      'b'.repeat(64),
    );

    expect(exact.status).toBe('exact');
    expect(sameParsed.status).toBe('same-parsed-content');
    expect(otherProfile).toEqual({ status: 'none' });
    expect(DuplicateDocumentResultSchema.parse(exact)).toEqual(exact);
    expect(DuplicateDocumentResultSchema.parse(sameParsed)).toEqual(sameParsed);

    const duplicateInsert = await repositories.documents.insert(
      document('document-same-content', 'profile-1', 'd', 'b'),
      [evidence('evidence-same-content', 'profile-1', 'document-same-content')],
    );
    expect(duplicateInsert.status).toBe('same-parsed-content');
    expect(await repositories.documents.get('document-same-content')).toBeUndefined();
    expect(await repositories.evidence.get('evidence-same-content')).toBeUndefined();
  });

  it('inserts documents and extracted evidence atomically and rolls back on failure', async () => {
    const database = await openTemporaryStorage();
    const repositories = createRoleProofRepositories(database, fixedClock());
    await repositories.profiles.create(profile('profile-1'));
    await repositories.documents.insert(document('document-1', 'profile-1', 'a', 'a'), [
      evidence('evidence-shared', 'profile-1', 'document-1'),
    ]);

    await expect(
      repositories.documents.insert(document('document-2', 'profile-1', 'b', 'b'), [
        evidence('evidence-shared', 'profile-1', 'document-2'),
      ]),
    ).rejects.toBeInstanceOf(StorageError);
    expect(await repositories.documents.get('document-2')).toBeUndefined();
    expect(await repositories.evidence.listByDocument('document-2')).toEqual([]);
  });

  it('supports multiple resumes and user evidence-note documents with stable ordering', async () => {
    const database = await openTemporaryStorage();
    const repositories = createRoleProofRepositories(database, fixedClock());
    await repositories.profiles.create(profile('profile-1'));

    await repositories.documents.insert(document('resume-z', 'profile-1', 'a', 'a'), []);
    await repositories.documents.insert(document('resume-a', 'profile-1', 'b', 'b'), []);
    await repositories.documents.insert(
      document('note-m', 'profile-1', 'c', 'c', 'evidence-note'),
      [evidence('note-evidence', 'profile-1', 'note-m')],
    );

    const stored = await repositories.documents.listByProfile('profile-1');
    expect(stored.map(({ id }) => id)).toEqual(['note-m', 'resume-a', 'resume-z']);
    expect(stored.every((value) => StoredDocumentSchema.safeParse(value).success)).toBe(true);
    expect(await repositories.documents.find('profile-1', 'resume-a')).toEqual(stored[1]);
  });

  it('does not insert duplicate documents or extracted evidence and preserves prior user edits', async () => {
    const database = await openTemporaryStorage();
    const repositories = createRoleProofRepositories(database, fixedClock());
    await repositories.profiles.create(profile('profile-1'));
    await repositories.documents.insert(document('document-1', 'profile-1', 'a', 'b'), [
      evidence('evidence-1', 'profile-1', 'document-1'),
    ]);
    await repositories.evidence.edit('evidence-1', { description: 'User-confirmed wording.' });

    const duplicate = await repositories.documents.insert(
      document('document-copy', 'profile-1', 'a', 'b'),
      [evidence('evidence-copy', 'profile-1', 'document-copy')],
    );

    expect(duplicate.status).toBe('exact');
    expect(await repositories.documents.get('document-copy')).toBeUndefined();
    expect(await repositories.evidence.get('evidence-copy')).toBeUndefined();
    expect(await repositories.evidence.get('evidence-1')).toMatchObject({
      description: 'User-confirmed wording.',
      confidence: 'user-confirmed',
    });
  });
});

describe('career evidence repository', () => {
  it('adds, edits, lists, and removes schema-validated evidence while preserving source fields', async () => {
    const database = await openTemporaryStorage();
    const repositories = createRoleProofRepositories(database, fixedClock());
    await repositories.profiles.create(profile('profile-1'));
    await repositories.documents.insert(document('document-z', 'profile-1', 'a', 'a'), []);
    await repositories.evidence.add(evidence('evidence-z', 'profile-1', 'document-z'));
    await repositories.evidence.add({
      ...evidence('evidence-a', 'profile-1', 'document-z'),
      sourceText: 'Original source sentence.',
    });

    const edited = await repositories.evidence.edit('evidence-a', {
      category: 'achievement',
      name: 'Service reliability',
      normalizedName: undefined,
      description: 'Improved a fictional service.',
      employer: undefined,
      project: undefined,
      startDate: undefined,
      endDate: undefined,
      // Runtime callers cannot rewrite immutable provenance even if they bypass TypeScript.
      sourceDocumentId: 'document-replacement',
      sourceText: 'Replacement source sentence.',
    } as Parameters<typeof repositories.evidence.edit>[1]);

    expect(CareerEvidenceSchema.parse(edited)).toEqual(edited);
    expect(edited).toMatchObject({
      sourceDocumentId: 'document-z',
      sourceText: 'Original source sentence.',
      confidence: 'user-confirmed',
    });
    expect((await repositories.evidence.listByProfile('profile-1')).map(({ id }) => id)).toEqual([
      'evidence-a',
      'evidence-z',
    ]);
    expect((await repositories.evidence.listByDocument('document-z')).map(({ id }) => id)).toEqual([
      'evidence-a',
      'evidence-z',
    ]);
    expect(await repositories.evidence.remove('evidence-z')).toBe(true);
    expect(await repositories.evidence.remove('evidence-z')).toBe(false);
  });

  it('rejects source document/profile ownership mismatches without exposing content', async () => {
    const database = await openTemporaryStorage();
    const repositories = createRoleProofRepositories(database, fixedClock());
    await repositories.profiles.create(profile('profile-1'));
    await repositories.profiles.create(profile('profile-2'));
    await repositories.documents.insert(document('document-1', 'profile-1', 'a', 'a'), []);
    const privateText = 'private fictional evidence sentence';

    const failure = repositories.evidence.add({
      ...evidence('evidence-invalid', 'profile-2', 'document-1'),
      description: privateText,
      sourceText: privateText,
    });

    await expect(failure).rejects.toBeInstanceOf(StorageError);
    await expect(failure).rejects.not.toThrow(privateText);
    expect(await repositories.evidence.get('evidence-invalid')).toBeUndefined();
  });
});

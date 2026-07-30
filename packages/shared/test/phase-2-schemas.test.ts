import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AnalysisHistoryItemSchema,
  CommandEnvelopeSchema,
  DuplicateDocumentResultSchema,
  EvidenceAddInputSchema,
  EvidenceEditInputSchema,
  EvidenceReferenceSchema,
  PageQuerySchema,
  SearchResultSchema,
  StoredDocumentSchema,
  StoredJobSchema,
  type AnalysisHistoryItem,
  type StoredDocument,
} from '../src/index.js';

const sha256 = 'a'.repeat(64);

const storedDocument = {
  schemaVersion: '1.0',
  id: 'document-1',
  profileId: 'profile-1',
  kind: 'resume',
  format: 'plaintext',
  originalName: 'fictional-resume.txt',
  contentSha256: sha256,
  parsedContentSha256: 'b'.repeat(64),
  text: 'Skills: TypeScript',
  confidence: 1,
  warnings: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as const;

describe('Phase 2 persistence schemas', () => {
  it('validates stored documents without accepting source paths or unknown fields', () => {
    const parsed = StoredDocumentSchema.parse(storedDocument);

    expect(parsed).toEqual(storedDocument);
    expectTypeOf(parsed).toEqualTypeOf<StoredDocument>();
    expect(
      StoredDocumentSchema.safeParse({ ...storedDocument, sourcePath: 'C:\\private' }).success,
    ).toBe(false);
    expect(
      StoredDocumentSchema.safeParse({ ...storedDocument, contentSha256: 'short' }).success,
    ).toBe(false);
  });

  it('supports user-authored evidence notes with explicit document provenance', () => {
    expect(
      StoredDocumentSchema.safeParse({
        ...storedDocument,
        id: 'document-note-1',
        kind: 'evidence-note',
        originalName: undefined,
      }).success,
    ).toBe(true);
  });

  it('validates stored jobs independently from future URL fetching', () => {
    const job = {
      schemaVersion: '1.0',
      id: 'job-1',
      format: 'plaintext',
      contentSha256: sha256,
      parsedContentSha256: 'c'.repeat(64),
      text: 'Required: TypeScript',
      confidence: 1,
      warnings: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as const;

    expect(StoredJobSchema.parse(job)).toEqual(job);
    expect(
      StoredJobSchema.safeParse({ ...job, sourceUrl: 'https://example.invalid/job' }).success,
    ).toBe(false);
  });

  it('classifies exact and normalized-content duplicates separately', () => {
    expect(
      DuplicateDocumentResultSchema.parse({ status: 'exact', document: storedDocument }),
    ).toEqual({ status: 'exact', document: storedDocument });
    expect(
      DuplicateDocumentResultSchema.safeParse({ status: 'none', document: storedDocument }).success,
    ).toBe(false);
  });

  it('validates resolvable evidence references for stored analyses', () => {
    expect(
      EvidenceReferenceSchema.parse({
        evidenceId: 'evidence-1',
        sourceType: 'career-evidence',
        sourceId: 'evidence-1',
        sourceDocumentId: 'document-1',
        sourceText: 'Skills: TypeScript',
        confidence: 'explicit',
      }),
    ).toMatchObject({ evidenceId: 'evidence-1', sourceDocumentId: 'document-1' });
  });

  it('validates bounded pagination and rejects non-finite search ranks', () => {
    expect(PageQuerySchema.parse({ limit: 25, offset: 0 })).toEqual({ limit: 25, offset: 0 });
    expect(PageQuerySchema.safeParse({ limit: 101, offset: 0 }).success).toBe(false);
    expect(PageQuerySchema.safeParse({ limit: 10, offset: -1 }).success).toBe(false);
    expect(
      SearchResultSchema.safeParse({
        entityType: 'analysis',
        id: 'analysis-1',
        title: 'Fictional analysis',
        snippet: 'TypeScript evidence',
        rank: Number.NaN,
      }).success,
    ).toBe(false);
  });

  it('keeps history summaries schema-versioned and typed', () => {
    const history = {
      schemaVersion: '1.0',
      id: 'analysis-1',
      profileId: 'profile-1',
      resumeDocumentId: 'document-1',
      jobId: 'job-1',
      overallScore: 82,
      recommendation: 'apply',
      confidence: 0.9,
      hasHardBlocker: false,
      generatedAt: '2026-01-01T00:00:00.000Z',
    } as const;

    const parsed = AnalysisHistoryItemSchema.parse(history);
    expect(parsed).toEqual(history);
    expectTypeOf(parsed).toEqualTypeOf<AnalysisHistoryItem>();
  });

  it('validates strict versioned CLI command envelopes', () => {
    expect(
      CommandEnvelopeSchema.parse({
        schemaVersion: '1.0',
        command: 'search',
        data: { results: [] },
      }),
    ).toEqual({ schemaVersion: '1.0', command: 'search', data: { results: [] } });
    expect(
      CommandEnvelopeSchema.safeParse({
        schemaVersion: '1.0',
        command: 'search',
        data: { results: [], extra: true },
      }).success,
    ).toBe(false);

    expect(
      CommandEnvelopeSchema.parse({
        schemaVersion: '1.0',
        command: 'providers.list',
        data: {
          providers: [
            {
              provider: 'openai-compatible',
              model: 'fictional-local',
              destination: 'local',
              configured: true,
            },
          ],
        },
      }).command,
    ).toBe('providers.list');
    expect(
      CommandEnvelopeSchema.parse({
        schemaVersion: '1.0',
        command: 'providers.test',
        data: {
          health: {
            provider: 'openai-compatible',
            destination: 'local',
            status: 'healthy',
            latencyMs: 4,
            errorCode: null,
            message: null,
          },
        },
      }).command,
    ).toBe('providers.test');
    expect(
      CommandEnvelopeSchema.safeParse({
        schemaVersion: '1.0',
        command: 'providers.list',
        data: { providers: [], apiKey: 'secret' },
      }).success,
    ).toBe(false);
  });

  it('requires exactly one evidence-add mode and a non-empty evidence edit', () => {
    expect(
      EvidenceAddInputSchema.safeParse({ profileId: 'profile-1', resume: 'resume.txt' }).success,
    ).toBe(true);
    expect(
      EvidenceAddInputSchema.safeParse({
        profileId: 'profile-1',
        category: 'skill',
        name: 'TypeScript',
        description: 'Built fictional services.',
      }).success,
    ).toBe(true);
    expect(
      EvidenceAddInputSchema.safeParse({
        profileId: 'profile-1',
        resume: 'resume.txt',
        category: 'skill',
        name: 'TypeScript',
        description: 'Built fictional services.',
      }).success,
    ).toBe(false);
    expect(EvidenceEditInputSchema.safeParse({ evidenceId: 'evidence-1' }).success).toBe(false);
    expect(
      EvidenceEditInputSchema.safeParse({ evidenceId: 'evidence-1', description: 'Updated.' })
        .success,
    ).toBe(true);
  });
});

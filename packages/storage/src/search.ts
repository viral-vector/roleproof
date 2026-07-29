import { SearchResultSchema, type SearchResult } from '@roleproof/shared';
import { sql } from 'kysely';

import type { StorageDatabase } from './database.js';
import { StorageError } from './errors.js';

interface SearchRow {
  entity_type: SearchResult['entityType'];
  id: string;
  title: string;
  snippet: string;
  rank: number;
}

export interface SearchRepository {
  search(query: string): Promise<SearchResult[]>;
}

function ftsQuery(input: string): string | undefined {
  const tokens = input.match(/[\p{L}\p{N}_]+/gu);
  if (tokens === null) return undefined;
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ');
}

function toSearchResult(row: SearchRow): SearchResult {
  return SearchResultSchema.parse({
    entityType: row.entity_type,
    id: row.id,
    title: row.title,
    snippet: row.snippet,
    rank: row.rank,
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createSearchRepository(database: StorageDatabase): SearchRepository {
  return {
    async search(input) {
      const query = ftsQuery(input);
      if (query === undefined) return [];
      try {
        const result = await sql<SearchRow>`
          select 'document' as entity_type, d.id, 'Document ' || d.id as title,
            snippet(documents_fts, 1, '', '', '...', 12) as snippet,
            bm25(documents_fts) as rank
          from documents_fts
          join documents d on d.rowid = documents_fts.rowid
          where documents_fts match ${query}
          union all
          select 'job', j.id, 'Job ' || j.id,
            snippet(jobs_fts, 1, '', '', '...', 12), bm25(jobs_fts)
          from jobs_fts
          join jobs j on j.rowid = jobs_fts.rowid
          where jobs_fts match ${query}
          union all
          select 'evidence', e.id, e.name,
            snippet(career_evidence_fts, -1, '', '', '...', 12), bm25(career_evidence_fts)
          from career_evidence_fts
          join career_evidence e on e.rowid = career_evidence_fts.rowid
          where career_evidence_fts match ${query}
          union all
          select 'analysis', a.id, 'Analysis ' || a.id,
            snippet(analyses_fts, 1, '', '', '...', 12), bm25(analyses_fts)
          from analyses_fts
          join analyses a on a.rowid = analyses_fts.rowid
          where analyses_fts match ${query}
          union all
          select 'analysis', a.id, 'Analysis ' || a.id,
            snippet(jobs_fts, 1, '', '', '...', 12), bm25(jobs_fts)
          from jobs_fts
          join jobs j on j.rowid = jobs_fts.rowid
          join analyses a on a.job_id = j.id
          where jobs_fts match ${query}
        `.execute(database);

        const byEntityAndId = new Map<string, SearchResult>();
        for (const row of result.rows) {
          const item = toSearchResult(row);
          const key = `${item.entityType}\0${item.id}`;
          const current = byEntityAndId.get(key);
          if (current === undefined || item.rank < current.rank) byEntityAndId.set(key, item);
        }
        return [...byEntityAndId.values()].sort(
          (left, right) =>
            left.rank - right.rank ||
            compareText(left.entityType, right.entityType) ||
            compareText(left.id, right.id),
        );
      } catch (cause) {
        throw new StorageError('SEARCH_FAILED', 'Unable to search stored data', { cause });
      }
    },
  };
}

export async function rebuildSearchIndexes(database: StorageDatabase): Promise<void> {
  try {
    await database.transaction().execute(async (transaction) => {
      await sql`insert into documents_fts(documents_fts) values ('rebuild')`.execute(transaction);
      await sql`insert into jobs_fts(jobs_fts) values ('rebuild')`.execute(transaction);
      await sql`insert into career_evidence_fts(career_evidence_fts) values ('rebuild')`.execute(
        transaction,
      );
      await sql`insert into analyses_fts(analyses_fts) values ('rebuild')`.execute(transaction);
    });
  } catch (cause) {
    throw new StorageError('SEARCH_FAILED', 'Unable to rebuild search indexes', { cause });
  }
}

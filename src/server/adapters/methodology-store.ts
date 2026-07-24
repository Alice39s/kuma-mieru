import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { methodologySnapshotSchema, type MethodologySnapshot } from './types.js';

interface MethodologyRow {
  snapshot_json: string;
  fetched_at: string;
  stale_after: string;
}

export interface MethodologyState {
  sourceId: string;
  pageId: string;
  snapshot: MethodologySnapshot;
  fetchedAt: string;
  staleAfter: string;
  stale: boolean;
}

export const saveMethodology = (
  database: Database.Database,
  sourceId: string,
  pageId: string,
  snapshot: MethodologySnapshot,
  staleAfter: Date
) => {
  const parsed = methodologySnapshotSchema.parse(snapshot);
  const serialized = JSON.stringify(parsed);
  const contentHash = createHash('sha256').update(serialized, 'utf8').digest('hex');
  const fetchedAt = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO source_methodologies
        (source_id, page_id, snapshot_json, content_hash, fetched_at, stale_after)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, page_id) DO UPDATE SET
         snapshot_json = excluded.snapshot_json,
         content_hash = excluded.content_hash,
         fetched_at = excluded.fetched_at,
         stale_after = excluded.stale_after`
    )
    .run(sourceId, pageId, serialized, contentHash, fetchedAt, staleAfter.toISOString());
  return contentHash;
};

export const getMethodologyState = (
  database: Database.Database,
  sourceId: string,
  pageId: string
): MethodologyState | null => {
  const row = database
    .prepare(
      `SELECT snapshot_json, fetched_at, stale_after
       FROM source_methodologies
       WHERE source_id = ? AND page_id = ?`
    )
    .get(sourceId, pageId) as MethodologyRow | undefined;
  if (!row) return null;
  return {
    sourceId,
    pageId,
    snapshot: methodologySnapshotSchema.parse(JSON.parse(row.snapshot_json)),
    fetchedAt: row.fetched_at,
    staleAfter: row.stale_after,
    stale: Date.parse(row.stale_after) <= Date.now(),
  };
};

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { normalizedSnapshotSchema, type NormalizedSnapshot } from './types.js';

interface SnapshotRow {
  snapshot_json: string;
}

interface SnapshotStateRow extends SnapshotRow {
  stale_after: string;
  state: 'healthy' | 'stale' | 'unavailable' | null;
  last_success_at: string | null;
  error_code: string | null;
}

export interface SourceSnapshotState {
  snapshot: NormalizedSnapshot;
  health: {
    state: 'healthy' | 'stale' | 'unavailable';
    stale: boolean;
    staleAfter: string;
    lastSuccessAt: string | null;
    errorCode: string | null;
  };
}

export const saveSourceSnapshot = (
  database: Database.Database,
  snapshot: NormalizedSnapshot,
  staleAfter: Date
) => {
  const parsed = normalizedSnapshotSchema.parse(snapshot);
  const serialized = JSON.stringify(parsed);
  const contentHash = createHash('sha256').update(serialized, 'utf8').digest('hex');
  const now = new Date().toISOString();

  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO source_snapshots
          (source_id, page_id, snapshot_json, content_hash, fetched_at, source_updated_at, stale_after)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id, page_id) DO UPDATE SET
           snapshot_json = excluded.snapshot_json,
           content_hash = excluded.content_hash,
           fetched_at = excluded.fetched_at,
           source_updated_at = excluded.source_updated_at,
           stale_after = excluded.stale_after`
      )
      .run(
        parsed.sourceId,
        parsed.pageId,
        serialized,
        contentHash,
        parsed.fetchedAt,
        parsed.sourceUpdatedAt,
        staleAfter.toISOString()
      );
    database
      .prepare(
        `INSERT INTO source_health
          (source_id, page_id, state, last_attempt_at, last_success_at, error_code, retry_at, consecutive_failures)
         VALUES (?, ?, 'healthy', ?, ?, NULL, NULL, 0)
         ON CONFLICT(source_id, page_id) DO UPDATE SET
           state = 'healthy',
           last_attempt_at = excluded.last_attempt_at,
           last_success_at = excluded.last_success_at,
           error_code = NULL,
           retry_at = NULL,
           consecutive_failures = 0`
      )
      .run(parsed.sourceId, parsed.pageId, now, now);
  })();

  return contentHash;
};

export const getSourceSnapshot = (
  database: Database.Database,
  sourceId: string,
  pageId: string
): NormalizedSnapshot | null => {
  const row = database
    .prepare('SELECT snapshot_json FROM source_snapshots WHERE source_id = ? AND page_id = ?')
    .get(sourceId, pageId) as SnapshotRow | undefined;
  return row ? normalizedSnapshotSchema.parse(JSON.parse(row.snapshot_json)) : null;
};

export const getSourceSnapshotState = (
  database: Database.Database,
  sourceId: string,
  pageId: string
): SourceSnapshotState | null => {
  const row = database
    .prepare(
      `SELECT snapshots.snapshot_json, snapshots.stale_after,
              health.state, health.last_success_at, health.error_code
       FROM source_snapshots AS snapshots
       LEFT JOIN source_health AS health
         ON health.source_id = snapshots.source_id AND health.page_id = snapshots.page_id
       WHERE snapshots.source_id = ? AND snapshots.page_id = ?`
    )
    .get(sourceId, pageId) as SnapshotStateRow | undefined;
  if (!row) return null;
  const state = row.state ?? 'stale';
  return {
    snapshot: normalizedSnapshotSchema.parse(JSON.parse(row.snapshot_json)),
    health: {
      state,
      stale: state !== 'healthy' || Date.parse(row.stale_after) <= Date.now(),
      staleAfter: row.stale_after,
      lastSuccessAt: row.last_success_at,
      errorCode: row.error_code,
    },
  };
};

export const recordSourceFailure = (
  database: Database.Database,
  sourceId: string,
  pageId: string,
  errorCode: string,
  retryAt: Date
) => {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO source_health
        (source_id, page_id, state, last_attempt_at, error_code, retry_at, consecutive_failures)
       VALUES (?, ?, 'unavailable', ?, ?, ?, 1)
       ON CONFLICT(source_id, page_id) DO UPDATE SET
         state = CASE WHEN source_health.last_success_at IS NULL THEN 'unavailable' ELSE 'stale' END,
         last_attempt_at = excluded.last_attempt_at,
         error_code = excluded.error_code,
         retry_at = excluded.retry_at,
         consecutive_failures = source_health.consecutive_failures + 1`
    )
    .run(sourceId, pageId, now, errorCode, retryAt.toISOString());
};

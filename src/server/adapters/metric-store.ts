import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { metricExtensionSchema, type MetricExtension } from './types.js';

interface MetricExtensionRow {
  extension_json: string;
  fetched_at: string;
  stale_after: string;
}

export interface MetricExtensionState {
  sourceId: string;
  pageId: string;
  extension: MetricExtension;
  fetchedAt: string;
  staleAfter: string;
  stale: boolean;
}

export const saveMetricExtension = (
  database: Database.Database,
  sourceId: string,
  pageId: string,
  extension: MetricExtension,
  staleAfter: Date
) => {
  const parsed = metricExtensionSchema.parse(extension);
  const serialized = JSON.stringify(parsed);
  const contentHash = createHash('sha256').update(serialized, 'utf8').digest('hex');
  const fetchedAt = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO source_metric_extensions
        (source_id, page_id, extension_json, content_hash, fetched_at, stale_after)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, page_id) DO UPDATE SET
         extension_json = excluded.extension_json,
         content_hash = excluded.content_hash,
         fetched_at = excluded.fetched_at,
         stale_after = excluded.stale_after`
    )
    .run(sourceId, pageId, serialized, contentHash, fetchedAt, staleAfter.toISOString());
  return contentHash;
};

export const getMetricExtensionState = (
  database: Database.Database,
  sourceId: string,
  pageId: string
): MetricExtensionState | null => {
  const row = database
    .prepare(
      `SELECT extension_json, fetched_at, stale_after
       FROM source_metric_extensions
       WHERE source_id = ? AND page_id = ?`
    )
    .get(sourceId, pageId) as MetricExtensionRow | undefined;
  if (!row) return null;
  return {
    sourceId,
    pageId,
    extension: metricExtensionSchema.parse(JSON.parse(row.extension_json)),
    fetchedAt: row.fetched_at,
    staleAfter: row.stale_after,
    stale: Date.parse(row.stale_after) <= Date.now(),
  };
};

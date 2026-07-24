import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { metricExtensionSchema, type MetricExtension } from './types.js';

interface MetricExtensionRow {
  window: MetricWindow;
  extension_json: string;
  fetched_at: string;
  stale_after: string;
}

export const metricWindows = ['5m', '1h', '1d', '7d', '30d'] as const;
export type MetricWindow = (typeof metricWindows)[number];

export const metricWindowRefreshMs: Record<MetricWindow, number> = {
  '5m': 5 * 60_000,
  '1h': 15 * 60_000,
  '1d': 60 * 60_000,
  '7d': 6 * 60 * 60_000,
  '30d': 24 * 60 * 60_000,
};

export interface MetricWindowState {
  sourceId: string;
  pageId: string;
  window: MetricWindow;
  extension: MetricExtension;
  fetchedAt: string;
  staleAfter: string;
  stale: boolean;
}

export const saveMetricWindow = (
  database: Database.Database,
  sourceId: string,
  pageId: string,
  window: MetricWindow,
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
        (source_id, page_id, window, extension_json, content_hash, fetched_at, stale_after)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, page_id, window) DO UPDATE SET
         extension_json = excluded.extension_json,
         content_hash = excluded.content_hash,
         fetched_at = excluded.fetched_at,
         stale_after = excluded.stale_after`
    )
    .run(sourceId, pageId, window, serialized, contentHash, fetchedAt, staleAfter.toISOString());
  return contentHash;
};

export const getMetricWindowStates = (
  database: Database.Database,
  sourceId: string,
  pageId: string
): MetricWindowState[] => {
  const rows = database
    .prepare(
      `SELECT window, extension_json, fetched_at, stale_after
       FROM source_metric_extensions
       WHERE source_id = ? AND page_id = ?
       ORDER BY CASE window
         WHEN '5m' THEN 1 WHEN '1h' THEN 2 WHEN '1d' THEN 3
         WHEN '7d' THEN 4 WHEN '30d' THEN 5 END`
    )
    .all(sourceId, pageId) as MetricExtensionRow[];
  return rows.map(row => ({
    sourceId,
    pageId,
    window: row.window,
    extension: metricExtensionSchema.parse(JSON.parse(row.extension_json)),
    fetchedAt: row.fetched_at,
    staleAfter: row.stale_after,
    stale: Date.parse(row.stale_after) <= Date.now(),
  }));
};

export const dueMetricWindows = (
  states: MetricWindowState[],
  now = Date.now(),
  maximum = 2
): MetricWindow[] => {
  const stateByWindow = new Map(states.map(state => [state.window, state]));
  return metricWindows
    .filter(window => {
      const state = stateByWindow.get(window);
      return !state || now - Date.parse(state.fetchedAt) >= metricWindowRefreshMs[window];
    })
    .slice(0, maximum);
};

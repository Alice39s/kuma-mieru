import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { normalizedSnapshotSchema, type NormalizedSnapshot } from '../adapters/types.js';

const mirroredSnapshotSchema = z.object({
  normalizedId: z.string().min(1),
  upstreamEventId: z.string().min(1),
  type: z.enum(['incident', 'maintenance']),
  title: z.string(),
  content: z.string(),
  severity: z.enum(['info', 'warning', 'danger', 'unknown']),
  startedAt: z.string().nullable(),
  sourceUpdatedAt: z.string().nullable(),
  rawStatus: z.string(),
});

const mirrorIdFor = (sourceId: string, pageId: string, type: string, upstreamEventId: string) =>
  `mir_${createHash('sha256')
    .update(`${sourceId}\0${pageId}\0${type}\0${upstreamEventId}`, 'utf8')
    .digest('hex')
    .slice(0, 32)}`;

const contentHashFor = (snapshotJson: string) =>
  createHash('sha256').update(snapshotJson, 'utf8').digest('hex');

const publicSourceUrl = (rawUrl: string) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Mirrored event source URL must use HTTP or HTTPS'), {
      code: 'invalid_source_url',
    });
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
};

interface MirroredEventRow {
  id: string;
  source_id: string;
  source_page_id: string;
  upstream_event_id: string;
  type: 'incident' | 'maintenance';
  source_url: string;
  presence: 'present' | 'absent';
  version: number;
  latest_content_hash: string;
  latest_snapshot_json: string;
  first_seen_at: string;
  last_seen_at: string;
  absent_at: string | null;
  updated_at: string;
}

interface MirroredEventEntryRow {
  sequence: number;
  observation_kind: 'initial' | 'updated' | 'absent' | 'reappeared';
  snapshot_json: string;
  content_hash: string;
  source_updated_at: string | null;
  observed_at: string;
  recorded_at: string;
}

export interface MirroredEventSourceFilter {
  sourceId: string;
  pageId: string;
}

export interface MirroredEventView {
  id: string;
  origin: 'mirrored';
  notificationEligible: false;
  type: 'incident' | 'maintenance';
  presence: 'present' | 'absent';
  version: number;
  title: string;
  content: string;
  severity: 'info' | 'warning' | 'danger' | 'unknown';
  startedAt: string | null;
  sourceUpdatedAt: string | null;
  rawStatus: string;
  firstSeenAt: string;
  lastSeenAt: string;
  absentAt: string | null;
  updatedAt: string;
  source: {
    id: string;
    pageId: string;
    eventId: string;
    url: string;
  };
}

export interface MirroredEventEntryView {
  sequence: number;
  observationKind: 'initial' | 'updated' | 'absent' | 'reappeared';
  snapshot: z.infer<typeof mirroredSnapshotSchema>;
  contentHash: string;
  sourceUpdatedAt: string | null;
  observedAt: string;
  recordedAt: string;
}

const viewFor = (row: MirroredEventRow): MirroredEventView => {
  const snapshot = mirroredSnapshotSchema.parse(JSON.parse(row.latest_snapshot_json));
  return {
    id: row.id,
    origin: 'mirrored',
    notificationEligible: false,
    type: row.type,
    presence: row.presence,
    version: row.version,
    title: snapshot.title,
    content: snapshot.content,
    severity: snapshot.severity,
    startedAt: snapshot.startedAt,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    rawStatus: snapshot.rawStatus,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    absentAt: row.absent_at,
    updatedAt: row.updated_at,
    source: {
      id: row.source_id,
      pageId: row.source_page_id,
      eventId: row.upstream_event_id,
      url: row.source_url,
    },
  };
};

const filterSql = (filters: MirroredEventSourceFilter[]) => ({
  predicate: filters.map(() => '(source_id = ? AND source_page_id = ?)').join(' OR '),
  parameters: filters.flatMap(filter => [filter.sourceId, filter.pageId]),
});

export const listMirroredEvents = (
  database: Database.Database,
  filters: MirroredEventSourceFilter[]
): MirroredEventView[] => {
  if (filters.length === 0) return [];
  const filter = filterSql(filters);
  const rows = database
    .prepare(
      `SELECT * FROM mirrored_events
       WHERE ${filter.predicate}
       ORDER BY CASE presence WHEN 'present' THEN 0 ELSE 1 END, updated_at DESC, id`
    )
    .all(...filter.parameters) as MirroredEventRow[];
  return rows.map(viewFor);
};

export const getMirroredEventTimeline = (
  database: Database.Database,
  filters: MirroredEventSourceFilter[],
  eventId: string
): (MirroredEventView & { entries: MirroredEventEntryView[] }) | null => {
  if (filters.length === 0) return null;
  const filter = filterSql(filters);
  const row = database
    .prepare(
      `SELECT * FROM mirrored_events
       WHERE id = ? AND (${filter.predicate})`
    )
    .get(eventId, ...filter.parameters) as MirroredEventRow | undefined;
  if (!row) return null;
  const entries = database
    .prepare(
      `SELECT sequence, observation_kind, snapshot_json, content_hash, source_updated_at,
              observed_at, recorded_at
       FROM mirrored_event_entries
       WHERE mirrored_event_id = ?
       ORDER BY sequence`
    )
    .all(eventId) as MirroredEventEntryRow[];
  return {
    ...viewFor(row),
    entries: entries.map(entry => ({
      sequence: entry.sequence,
      observationKind: entry.observation_kind,
      snapshot: mirroredSnapshotSchema.parse(JSON.parse(entry.snapshot_json)),
      contentHash: entry.content_hash,
      sourceUpdatedAt: entry.source_updated_at,
      observedAt: entry.observed_at,
      recordedAt: entry.recorded_at,
    })),
  };
};

export const reconcileMirroredEvents = (
  database: Database.Database,
  rawSnapshot: NormalizedSnapshot,
  { sourceUrl, now = () => new Date() }: { sourceUrl: string; now?: () => Date }
) => {
  const snapshot = normalizedSnapshotSchema.parse(rawSnapshot);
  if (snapshot.capabilities.incidents === 'none') {
    return { created: 0, updated: 0, absent: 0, reappeared: 0, unchanged: 0 };
  }
  const sanitizedSourceUrl = publicSourceUrl(sourceUrl);
  const observedAt = snapshot.fetchedAt;
  const recordedAt = now().toISOString();
  const events = snapshot.incidents.map(event => {
    const payload = mirroredSnapshotSchema.parse({
      normalizedId: event.id,
      upstreamEventId: event.sourceEventId,
      type: event.kind,
      title: event.title,
      content: event.content,
      severity: event.severity,
      startedAt: event.startedAt,
      sourceUpdatedAt: event.updatedAt,
      rawStatus: event.rawStatus,
    });
    const snapshotJson = JSON.stringify(payload);
    return {
      payload,
      snapshotJson,
      contentHash: contentHashFor(snapshotJson),
      id: mirrorIdFor(snapshot.sourceId, snapshot.pageId, event.kind, event.sourceEventId),
    };
  });

  return database.transaction(() => {
    const existing = database
      .prepare(
        `SELECT * FROM mirrored_events
         WHERE source_id = ? AND source_page_id = ?`
      )
      .all(snapshot.sourceId, snapshot.pageId) as MirroredEventRow[];
    const existingById = new Map(existing.map(event => [event.id, event]));
    const seen = new Set<string>();
    const counts = { created: 0, updated: 0, absent: 0, reappeared: 0, unchanged: 0 };
    const insertEntry = database.prepare(
      `INSERT INTO mirrored_event_entries
        (id, mirrored_event_id, sequence, observation_kind, snapshot_json, content_hash,
         source_updated_at, observed_at, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const event of events) {
      seen.add(event.id);
      const current = existingById.get(event.id);
      if (!current) {
        database
          .prepare(
            `INSERT INTO mirrored_events
              (id, source_id, source_page_id, upstream_event_id, type, source_url, presence,
               version, latest_content_hash, latest_snapshot_json, first_seen_at, last_seen_at,
               absent_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'present', 1, ?, ?, ?, ?, NULL, ?)`
          )
          .run(
            event.id,
            snapshot.sourceId,
            snapshot.pageId,
            event.payload.upstreamEventId,
            event.payload.type,
            sanitizedSourceUrl,
            event.contentHash,
            event.snapshotJson,
            observedAt,
            observedAt,
            recordedAt
          );
        insertEntry.run(
          randomUUID(),
          event.id,
          1,
          'initial',
          event.snapshotJson,
          event.contentHash,
          event.payload.sourceUpdatedAt,
          observedAt,
          recordedAt
        );
        counts.created += 1;
        continue;
      }

      const reappeared = current.presence === 'absent';
      const changed = current.latest_content_hash !== event.contentHash;
      if (!reappeared && !changed) {
        database
          .prepare(
            `UPDATE mirrored_events
             SET source_url = ?, last_seen_at = ?
             WHERE id = ?`
          )
          .run(sanitizedSourceUrl, observedAt, event.id);
        counts.unchanged += 1;
        continue;
      }

      const nextVersion = current.version + 1;
      database
        .prepare(
          `UPDATE mirrored_events
           SET source_url = ?, presence = 'present', version = ?, latest_content_hash = ?,
               latest_snapshot_json = ?, last_seen_at = ?, absent_at = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(
          sanitizedSourceUrl,
          nextVersion,
          event.contentHash,
          event.snapshotJson,
          observedAt,
          recordedAt,
          event.id
        );
      insertEntry.run(
        randomUUID(),
        event.id,
        nextVersion,
        reappeared ? 'reappeared' : 'updated',
        event.snapshotJson,
        event.contentHash,
        event.payload.sourceUpdatedAt,
        observedAt,
        recordedAt
      );
      counts[reappeared ? 'reappeared' : 'updated'] += 1;
    }

    for (const event of existing) {
      if (event.presence === 'absent' || seen.has(event.id)) continue;
      const nextVersion = event.version + 1;
      database
        .prepare(
          `UPDATE mirrored_events
           SET presence = 'absent', version = ?, absent_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(nextVersion, observedAt, recordedAt, event.id);
      const latest = mirroredSnapshotSchema.parse(JSON.parse(event.latest_snapshot_json));
      insertEntry.run(
        randomUUID(),
        event.id,
        nextVersion,
        'absent',
        event.latest_snapshot_json,
        event.latest_content_hash,
        latest.sourceUpdatedAt,
        observedAt,
        recordedAt
      );
      counts.absent += 1;
    }

    return counts;
  })();
};

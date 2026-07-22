import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuditContext } from '../config/managed-config.js';
import type { PiiProtector } from '../subscriptions/crypto.js';
import {
  noticeCreateSchema,
  noticePublicationSnapshotSchema,
  noticeUpdateSchema,
  noticeWindowSchema,
  publicationSnapshotSchema,
  type NoticeCreateInput,
  type NoticeKind,
  type NoticePublicationSnapshot,
  type NoticeState,
  type NoticeUpdateInput,
} from './schemas.js';
import {
  eventError,
  getNativePublicationReview,
  hashInput,
  publishNativeEvent,
  writeEventAudit,
  type NativePublicationReview,
  type PublishableEventRecord,
} from './repository.js';

interface NoticeRow {
  id: string;
  type: string;
  page_id: string;
  title: string;
  state: NoticeState;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  request_hash: string;
  details_json: string;
}

interface NoticeDetails {
  kind: NoticeKind;
  startsAt: string | null;
  endsAt: string | null;
}

interface NoticeEntryRow {
  sequence: number;
  state: NoticeState;
  title: string;
  body: string;
  affected_components_json: string;
  occurred_at: string;
  recorded_at: string;
  actor_id: string;
  details_json: string;
}

export interface NoticeRecord extends PublishableEventRecord {
  type: 'notice';
  state: NoticeState;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  kind: NoticeKind;
  startsAt: string | null;
  endsAt: string | null;
  latestEntry: PublishableEventRecord['latestEntry'] & {
    state: NoticeState;
    title: string;
    actorId: string;
    kind: NoticeKind;
    startsAt: string | null;
    endsAt: string | null;
  };
}

const columns = `
  id, type, page_id, title, state, version, created_by, created_at,
  updated_at, request_hash, details_json`;

const parseDetails = (value: string): NoticeDetails => noticeWindowSchema.parse(JSON.parse(value));

const getEntry = (
  database: Database.Database,
  eventId: string,
  sequence: number
): NoticeRecord['latestEntry'] => {
  const row = database
    .prepare(
      `SELECT sequence, state, title, body, affected_components_json,
              occurred_at, recorded_at, actor_id, details_json
       FROM native_event_entries WHERE event_id = ? AND sequence = ?`
    )
    .get(eventId, sequence) as NoticeEntryRow | undefined;
  if (!row) throw eventError('event_entry_missing', 'Notice entry does not exist');
  return {
    sequence: row.sequence,
    state: row.state,
    title: row.title,
    body: row.body,
    affectedComponentIds: JSON.parse(row.affected_components_json) as string[],
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    actorId: row.actor_id,
    ...parseDetails(row.details_json),
  };
};

const parseNotice = (database: Database.Database, row: NoticeRow): NoticeRecord => {
  const details = parseDetails(row.details_json);
  return {
    id: row.id,
    type: 'notice',
    pageId: row.page_id,
    title: row.title,
    state: row.state,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...details,
    publicationDetails: { ...details },
    latestEntry: getEntry(database, row.id, row.version),
  };
};

export const getNotice = (database: Database.Database, eventId: string): NoticeRecord | null => {
  const row = database
    .prepare(`SELECT ${columns} FROM native_events WHERE id = ? AND type = 'notice'`)
    .get(eventId) as NoticeRow | undefined;
  return row ? parseNotice(database, row) : null;
};

export const listNotices = (database: Database.Database, limit = 100): NoticeRecord[] => {
  const rows = database
    .prepare(
      `SELECT ${columns} FROM native_events
       WHERE type = 'notice' ORDER BY updated_at DESC LIMIT ?`
    )
    .all(Math.min(Math.max(limit, 1), 100)) as NoticeRow[];
  return rows.map(row => parseNotice(database, row));
};

export const createNotice = (
  database: Database.Database,
  rawInput: NoticeCreateInput,
  idempotencyKey: string,
  audit: AuditContext
): NoticeRecord => {
  const input = noticeCreateSchema.parse(rawInput);
  const requestHash = hashInput(input);
  return database.transaction(() => {
    const existing = database
      .prepare(`SELECT ${columns} FROM native_events WHERE created_by = ? AND idempotency_key = ?`)
      .get(audit.actorId, idempotencyKey) as NoticeRow | undefined;
    if (existing) {
      if (existing.type !== 'notice' || existing.request_hash !== requestHash) {
        throw eventError(
          'idempotency_key_reused',
          'Idempotency key was already used for another request'
        );
      }
      return parseNotice(database, existing);
    }

    const id = randomUUID();
    const recordedAt = new Date().toISOString();
    const details: NoticeDetails = {
      kind: input.kind,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    };
    database
      .prepare(
        `INSERT INTO native_events
          (id, type, page_id, title, state, version, created_by, idempotency_key,
           request_hash, created_at, updated_at, details_json)
         VALUES (?, 'notice', ?, ?, 'draft', 1, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.pageId,
        input.title,
        audit.actorId,
        idempotencyKey,
        requestHash,
        recordedAt,
        recordedAt,
        JSON.stringify(details)
      );
    database
      .prepare(
        `INSERT INTO native_event_entries
          (id, event_id, sequence, kind, state, title, body, affected_components_json,
           occurred_at, recorded_at, actor_id, details_json)
         VALUES (?, ?, 1, 'created', 'draft', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        id,
        input.title,
        input.body,
        JSON.stringify(input.affectedComponentIds),
        input.occurredAt ?? recordedAt,
        recordedAt,
        audit.actorId,
        JSON.stringify(details)
      );
    writeEventAudit(database, audit, 'notice.create', id, {
      version: 1,
      state: 'draft',
      pageId: input.pageId,
      ...details,
    });
    return getNotice(database, id) as NoticeRecord;
  })();
};

const allowedTransitions: Record<NoticeState, NoticeState[]> = {
  draft: ['draft', 'published', 'withdrawn'],
  published: ['published', 'expired', 'withdrawn'],
  expired: ['expired'],
  withdrawn: ['withdrawn'],
};

export const appendNoticeUpdate = (
  database: Database.Database,
  eventId: string,
  rawInput: NoticeUpdateInput,
  audit: AuditContext
): NoticeRecord => {
  const input = noticeUpdateSchema.parse(rawInput);
  return database.transaction(() => {
    const current = getNotice(database, eventId);
    if (!current) throw eventError('event_not_found', 'Notice does not exist');
    if (current.version !== input.expectedVersion) {
      throw eventError(
        'event_version_conflict',
        `Expected version ${input.expectedVersion}, active version is ${current.version}`
      );
    }
    if (!allowedTransitions[current.state].includes(input.state)) {
      throw eventError(
        'invalid_event_transition',
        `Cannot transition notice from ${current.state} to ${input.state}`
      );
    }
    const details = noticeWindowSchema.parse({
      kind: input.kind ?? current.kind,
      startsAt: input.startsAt === undefined ? current.startsAt : input.startsAt,
      endsAt: input.endsAt === undefined ? current.endsAt : input.endsAt,
    });
    const sequence = current.version + 1;
    const recordedAt = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO native_event_entries
          (id, event_id, sequence, kind, state, title, body, affected_components_json,
           occurred_at, recorded_at, actor_id, details_json)
         VALUES (?, ?, ?, 'update', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        eventId,
        sequence,
        input.state,
        current.title,
        input.body,
        JSON.stringify(input.affectedComponentIds ?? current.latestEntry.affectedComponentIds),
        input.occurredAt ?? recordedAt,
        recordedAt,
        audit.actorId,
        JSON.stringify(details)
      );
    database
      .prepare(
        `UPDATE native_events
         SET state = ?, version = ?, updated_at = ?, details_json = ? WHERE id = ?`
      )
      .run(input.state, sequence, recordedAt, JSON.stringify(details), eventId);
    writeEventAudit(database, audit, 'notice.update', eventId, {
      version: sequence,
      state: input.state,
      ...details,
    });
    return getNotice(database, eventId) as NoticeRecord;
  })();
};

const getPublishableNotice = (database: Database.Database, eventId: string) => {
  const notice = getNotice(database, eventId);
  if (notice?.state === 'draft') {
    throw eventError('event_not_publishable', 'Notice must leave draft before it can be published');
  }
  return notice;
};

export const getNoticePublicationReview = (
  database: Database.Database,
  eventId: string,
  expectedVersion: number
): NativePublicationReview<NoticeRecord> =>
  getNativePublicationReview(database, getPublishableNotice(database, eventId), expectedVersion);

export const publishNotice = (
  database: Database.Database,
  input: {
    eventId: string;
    expectedVersion: number;
    notifySubscribers: boolean;
    expectedRecipients: number;
    piiProtector?: PiiProtector;
  },
  audit: AuditContext
): NoticePublicationSnapshot =>
  noticePublicationSnapshotSchema.parse(
    publishNativeEvent(database, () => getPublishableNotice(database, input.eventId), input, audit)
  );

export const listPublishedNotices = (
  database: Database.Database,
  pageId: string,
  limit = 100
): NoticePublicationSnapshot[] => {
  const rows = database
    .prepare(
      `SELECT content_json FROM event_publications
       WHERE page_id = ? ORDER BY published_at DESC LIMIT ?`
    )
    .all(pageId, Math.min(Math.max(limit, 1), 100)) as Array<{ content_json: string }>;
  return rows
    .map(row => publicationSnapshotSchema.parse(JSON.parse(row.content_json)))
    .filter((item): item is NoticePublicationSnapshot => item.type === 'notice');
};

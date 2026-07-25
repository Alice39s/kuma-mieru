import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuditContext } from '../config/managed-config.js';
import type { PiiProtector } from '../subscriptions/crypto.js';
import {
  postmortemCreateSchema,
  postmortemPublicationSnapshotSchema,
  postmortemUpdateSchema,
  publicationSnapshotSchema,
  type PostmortemCreateInput,
  type PostmortemPublicationSnapshot,
  type PostmortemState,
  type PostmortemUpdateInput,
} from './schemas.js';
import {
  eventError,
  getIncident,
  getNativePublicationReview,
  hashInput,
  publishNativeEvent,
  writeEventAudit,
  type NativePublicationReview,
  type PublishableEventRecord,
} from './repository.js';
import {
  parseAppliedEventTemplate,
  resolveEventTemplateApplication,
} from './template-repository.js';

interface PostmortemRow {
  id: string;
  page_id: string;
  title: string;
  state: PostmortemState;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  request_hash: string;
  parent_event_id: string;
  source_template_id: string | null;
  source_template_version: number | null;
  source_template_notify_suggestion: number | null;
}

interface EntryRow {
  sequence: number;
  state: PostmortemState;
  title: string;
  body: string;
  affected_components_json: string;
  occurred_at: string;
  recorded_at: string;
  actor_id: string;
}

export interface PostmortemRecord extends PublishableEventRecord {
  type: 'postmortem';
  state: PostmortemState;
  incidentId: string;
  subscriptionScopeEventId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  latestEntry: PublishableEventRecord['latestEntry'] & {
    state: PostmortemState;
    title: string;
    actorId: string;
  };
}

const columns = `
  id, page_id, title, state, version, created_by, created_at,
  updated_at, request_hash, parent_event_id, source_template_id, source_template_version,
  source_template_notify_suggestion`;

const getEntry = (
  database: Database.Database,
  eventId: string,
  sequence: number
): PostmortemRecord['latestEntry'] => {
  const row = database
    .prepare(
      `SELECT sequence, state, title, body, affected_components_json,
              occurred_at, recorded_at, actor_id
       FROM native_event_entries WHERE event_id = ? AND sequence = ?`
    )
    .get(eventId, sequence) as EntryRow | undefined;
  if (!row) throw eventError('event_entry_missing', 'Postmortem entry does not exist');
  return {
    sequence: row.sequence,
    state: row.state,
    title: row.title,
    body: row.body,
    affectedComponentIds: JSON.parse(row.affected_components_json) as string[],
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    actorId: row.actor_id,
  };
};

const parsePostmortem = (database: Database.Database, row: PostmortemRow): PostmortemRecord => ({
  id: row.id,
  type: 'postmortem',
  pageId: row.page_id,
  title: row.title,
  state: row.state,
  version: row.version,
  incidentId: row.parent_event_id,
  subscriptionScopeEventId: row.parent_event_id,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  template: parseAppliedEventTemplate(row),
  publicationDetails: { incidentId: row.parent_event_id },
  latestEntry: getEntry(database, row.id, row.version),
});

export const getPostmortem = (
  database: Database.Database,
  eventId: string
): PostmortemRecord | null => {
  const row = database
    .prepare(`SELECT ${columns} FROM native_events WHERE id = ? AND type = 'postmortem'`)
    .get(eventId) as PostmortemRow | undefined;
  return row ? parsePostmortem(database, row) : null;
};

export const listPostmortems = (
  database: Database.Database,
  incidentId?: string,
  limit = 100
): PostmortemRecord[] => {
  const rows = incidentId
    ? (database
        .prepare(
          `SELECT ${columns} FROM native_events
           WHERE type = 'postmortem' AND parent_event_id = ? ORDER BY updated_at DESC LIMIT ?`
        )
        .all(incidentId, Math.min(Math.max(limit, 1), 100)) as PostmortemRow[])
    : (database
        .prepare(
          `SELECT ${columns} FROM native_events
           WHERE type = 'postmortem' ORDER BY updated_at DESC LIMIT ?`
        )
        .all(Math.min(Math.max(limit, 1), 100)) as PostmortemRow[]);
  return rows.map(row => parsePostmortem(database, row));
};

export const createPostmortem = (
  database: Database.Database,
  rawInput: PostmortemCreateInput,
  idempotencyKey: string,
  audit: AuditContext
): PostmortemRecord => {
  const input = postmortemCreateSchema.parse(rawInput);
  const requestHash = hashInput(input);
  return database.transaction(() => {
    const existing = database
      .prepare(`SELECT ${columns} FROM native_events WHERE created_by = ? AND idempotency_key = ?`)
      .get(audit.actorId, idempotencyKey) as PostmortemRow | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw eventError('idempotency_key_reused', 'Idempotency key was reused');
      }
      return parsePostmortem(database, existing);
    }
    const incident = getIncident(database, input.incidentId);
    if (!incident) throw eventError('parent_incident_not_found', 'Parent incident does not exist');
    if (incident.state !== 'resolved') {
      throw eventError('incident_not_resolved', 'Postmortem requires a resolved incident');
    }
    const template = resolveEventTemplateApplication(database, input.template, 'postmortem');
    const id = randomUUID();
    const recordedAt = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO native_events
          (id, type, page_id, title, state, version, created_by, idempotency_key,
           request_hash, created_at, updated_at, details_json, parent_event_id,
           source_template_id, source_template_version, source_template_notify_suggestion)
         VALUES (?, 'postmortem', ?, ?, 'draft', 1, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)`
      )
      .run(
        id,
        incident.pageId,
        input.title,
        audit.actorId,
        idempotencyKey,
        requestHash,
        recordedAt,
        recordedAt,
        incident.id,
        template?.id ?? null,
        template?.version ?? null,
        template ? (template.defaultNotifySubscribers ? 1 : 0) : null
      );
    database
      .prepare(
        `INSERT INTO native_event_entries
          (id, event_id, sequence, kind, state, title, body, affected_components_json,
           occurred_at, recorded_at, actor_id, details_json)
         VALUES (?, ?, 1, 'created', 'draft', ?, ?, ?, ?, ?, ?, '{}')`
      )
      .run(
        randomUUID(),
        id,
        input.title,
        input.body,
        JSON.stringify(incident.latestEntry.affectedComponentIds),
        input.occurredAt ?? recordedAt,
        recordedAt,
        audit.actorId
      );
    writeEventAudit(database, audit, 'postmortem.create', id, {
      version: 1,
      state: 'draft',
      incidentId: incident.id,
    });
    return getPostmortem(database, id) as PostmortemRecord;
  })();
};

const allowedTransitions: Record<PostmortemState, PostmortemState[]> = {
  draft: ['draft', 'reviewed'],
  reviewed: ['reviewed', 'published'],
  published: ['published'],
};

export const appendPostmortemUpdate = (
  database: Database.Database,
  eventId: string,
  rawInput: PostmortemUpdateInput,
  audit: AuditContext
): PostmortemRecord => {
  const input = postmortemUpdateSchema.parse(rawInput);
  return database.transaction(() => {
    const current = getPostmortem(database, eventId);
    if (!current) throw eventError('event_not_found', 'Postmortem does not exist');
    if (current.version !== input.expectedVersion) {
      throw eventError('event_version_conflict', 'Postmortem version changed');
    }
    if (!allowedTransitions[current.state].includes(input.state)) {
      throw eventError('invalid_event_transition', 'Invalid postmortem state transition');
    }
    const sequence = current.version + 1;
    const recordedAt = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO native_event_entries
          (id, event_id, sequence, kind, state, title, body, affected_components_json,
           occurred_at, recorded_at, actor_id, details_json)
         VALUES (?, ?, ?, 'update', ?, ?, ?, ?, ?, ?, ?, '{}')`
      )
      .run(
        randomUUID(),
        eventId,
        sequence,
        input.state,
        current.title,
        input.body,
        JSON.stringify(current.latestEntry.affectedComponentIds),
        input.occurredAt ?? recordedAt,
        recordedAt,
        audit.actorId
      );
    database
      .prepare(`UPDATE native_events SET state = ?, version = ?, updated_at = ? WHERE id = ?`)
      .run(input.state, sequence, recordedAt, eventId);
    writeEventAudit(database, audit, 'postmortem.update', eventId, {
      version: sequence,
      state: input.state,
    });
    return getPostmortem(database, eventId) as PostmortemRecord;
  })();
};

const getPublishablePostmortem = (database: Database.Database, eventId: string) => {
  const postmortem = getPostmortem(database, eventId);
  if (postmortem && postmortem.state !== 'published') {
    throw eventError(
      'event_not_publishable',
      'Postmortem must complete review before it can be published'
    );
  }
  return postmortem;
};

export const getPostmortemPublicationReview = (
  database: Database.Database,
  eventId: string,
  expectedVersion: number
): NativePublicationReview<PostmortemRecord> =>
  getNativePublicationReview(
    database,
    getPublishablePostmortem(database, eventId),
    expectedVersion
  );

export const publishPostmortem = (
  database: Database.Database,
  input: {
    eventId: string;
    expectedVersion: number;
    notifySubscribers: boolean;
    expectedRecipients: number;
    piiProtector?: PiiProtector;
  },
  audit: AuditContext
): PostmortemPublicationSnapshot =>
  postmortemPublicationSnapshotSchema.parse(
    publishNativeEvent(
      database,
      () => getPublishablePostmortem(database, input.eventId),
      input,
      audit
    )
  );

export const listPublishedPostmortems = (
  database: Database.Database,
  pageId: string,
  incidentId: string
): PostmortemPublicationSnapshot[] => {
  const rows = database
    .prepare(
      `SELECT content_json FROM event_publications
       WHERE page_id = ? ORDER BY published_at DESC`
    )
    .all(pageId) as Array<{ content_json: string }>;
  return rows
    .map(row => publicationSnapshotSchema.parse(JSON.parse(row.content_json)))
    .filter(
      (item): item is PostmortemPublicationSnapshot =>
        item.type === 'postmortem' && item.incidentId === incidentId
    );
};

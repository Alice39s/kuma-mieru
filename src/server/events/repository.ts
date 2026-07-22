import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuditContext } from '../config/managed-config.js';
import type { PiiProtector } from '../subscriptions/crypto.js';
import {
  incidentCreateSchema,
  incidentPublicationSnapshotSchema,
  incidentUpdateSchema,
  publicationSnapshotSchema,
  type IncidentCreateInput,
  type IncidentState,
  type IncidentUpdateInput,
  type IncidentPublicationSnapshot,
  type PublicationSnapshot,
} from './schemas.js';

interface EventRow {
  id: string;
  page_id: string;
  title: string;
  state: IncidentState;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  request_hash: string;
}

interface EntryRow {
  sequence: number;
  state: IncidentState;
  title: string;
  body: string;
  affected_components_json: string;
  occurred_at: string;
  recorded_at: string;
  actor_id: string;
}

interface SubscriptionRow {
  id: string;
  incident_id: string | null;
  component_ids_json: string;
}

export interface IncidentRecord {
  id: string;
  type: 'incident';
  pageId: string;
  title: string;
  state: IncidentState;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publicationDetails: Record<string, never>;
  latestEntry: {
    sequence: number;
    state: IncidentState;
    title: string;
    body: string;
    affectedComponentIds: string[];
    occurredAt: string;
    recordedAt: string;
    actorId: string;
  };
}

export interface PublishableEventRecord {
  id: string;
  type: 'incident' | 'maintenance' | 'notice';
  pageId: string;
  title: string;
  state: string;
  version: number;
  publicationDetails: Record<string, unknown>;
  latestEntry: {
    sequence: number;
    body: string;
    affectedComponentIds: string[];
    occurredAt: string;
    recordedAt: string;
  };
}

export interface NativePublicationReview<T extends PublishableEventRecord> {
  event: T;
  estimatedRecipients: number;
}

export interface PublicationReview {
  incident: IncidentRecord;
  estimatedRecipients: number;
}

export const eventError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

export const hashInput = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input), 'utf8').digest('hex');

const parseEntry = (row: EntryRow): IncidentRecord['latestEntry'] => ({
  sequence: row.sequence,
  state: row.state,
  title: row.title,
  body: row.body,
  affectedComponentIds: JSON.parse(row.affected_components_json) as string[],
  occurredAt: row.occurred_at,
  recordedAt: row.recorded_at,
  actorId: row.actor_id,
});

const getEntry = (database: Database.Database, eventId: string, sequence: number) => {
  const row = database
    .prepare(
      `SELECT sequence, state, title, body, affected_components_json,
              occurred_at, recorded_at, actor_id
       FROM native_event_entries
       WHERE event_id = ? AND sequence = ?`
    )
    .get(eventId, sequence) as EntryRow | undefined;
  if (!row) throw eventError('event_entry_missing', 'Incident entry does not exist');
  return parseEntry(row);
};

const parseIncident = (database: Database.Database, row: EventRow): IncidentRecord => ({
  id: row.id,
  type: 'incident',
  pageId: row.page_id,
  title: row.title,
  state: row.state,
  version: row.version,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  publicationDetails: {},
  latestEntry: getEntry(database, row.id, row.version),
});

export const getIncident = (
  database: Database.Database,
  eventId: string
): IncidentRecord | null => {
  const row = database
    .prepare(
      `SELECT id, page_id, title, state, version, created_by, created_at, updated_at, request_hash
       FROM native_events WHERE id = ? AND type = 'incident'`
    )
    .get(eventId) as EventRow | undefined;
  return row ? parseIncident(database, row) : null;
};

export const listIncidents = (database: Database.Database, limit = 100): IncidentRecord[] => {
  const rows = database
    .prepare(
      `SELECT id, page_id, title, state, version, created_by, created_at, updated_at, request_hash
       FROM native_events WHERE type = 'incident'
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(Math.min(Math.max(limit, 1), 100)) as EventRow[];
  return rows.map(row => parseIncident(database, row));
};

export const writeEventAudit = (
  database: Database.Database,
  audit: AuditContext,
  action: string,
  eventId: string,
  after: unknown
) => {
  database
    .prepare(
      `INSERT INTO admin_audit
        (id, occurred_at, actor_id, action, target_type, target_id, request_id,
         ip_address, user_agent, result, after_json)
       VALUES (?, ?, ?, ?, 'native_event', ?, ?, ?, ?, 'success', ?)`
    )
    .run(
      randomUUID(),
      new Date().toISOString(),
      audit.actorId,
      action,
      eventId,
      audit.requestId,
      audit.ipAddress ?? null,
      audit.userAgent ?? null,
      JSON.stringify(after)
    );
};

export const createIncident = (
  database: Database.Database,
  rawInput: IncidentCreateInput,
  idempotencyKey: string,
  audit: AuditContext
): IncidentRecord => {
  const input = incidentCreateSchema.parse(rawInput);
  const requestHash = hashInput(input);
  return database.transaction(() => {
    const existing = database
      .prepare(
        `SELECT id, page_id, title, state, version, created_by, created_at, updated_at, request_hash
         FROM native_events WHERE created_by = ? AND idempotency_key = ?`
      )
      .get(audit.actorId, idempotencyKey) as EventRow | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw eventError(
          'idempotency_key_reused',
          'Idempotency key was already used for another request'
        );
      }
      return parseIncident(database, existing);
    }

    const id = randomUUID();
    const recordedAt = new Date().toISOString();
    const occurredAt = input.occurredAt ?? recordedAt;
    database
      .prepare(
        `INSERT INTO native_events
          (id, type, page_id, title, state, version, created_by, idempotency_key,
           request_hash, created_at, updated_at)
         VALUES (?, 'incident', ?, ?, ?, 1, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.pageId,
        input.title,
        input.state,
        audit.actorId,
        idempotencyKey,
        requestHash,
        recordedAt,
        recordedAt
      );
    database
      .prepare(
        `INSERT INTO native_event_entries
          (id, event_id, sequence, kind, state, title, body, affected_components_json,
           occurred_at, recorded_at, actor_id)
         VALUES (?, ?, 1, 'created', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        id,
        input.state,
        input.title,
        input.body,
        JSON.stringify(input.affectedComponentIds),
        occurredAt,
        recordedAt,
        audit.actorId
      );
    writeEventAudit(database, audit, 'incident.create', id, {
      version: 1,
      state: input.state,
      pageId: input.pageId,
    });
    return getIncident(database, id) as IncidentRecord;
  })();
};

const allowedTransitions: Record<IncidentState, IncidentState[]> = {
  investigating: ['investigating', 'identified', 'monitoring', 'resolved'],
  identified: ['identified', 'monitoring', 'resolved'],
  monitoring: ['monitoring', 'resolved'],
  resolved: ['resolved'],
};

export const appendIncidentUpdate = (
  database: Database.Database,
  eventId: string,
  rawInput: IncidentUpdateInput,
  audit: AuditContext
): IncidentRecord => {
  const input = incidentUpdateSchema.parse(rawInput);
  return database.transaction(() => {
    const current = getIncident(database, eventId);
    if (!current) throw eventError('event_not_found', 'Incident does not exist');
    if (current.version !== input.expectedVersion) {
      throw eventError(
        'event_version_conflict',
        `Expected version ${input.expectedVersion}, active version is ${current.version}`
      );
    }
    if (!allowedTransitions[current.state].includes(input.state)) {
      throw eventError(
        'invalid_event_transition',
        `Cannot transition incident from ${current.state} to ${input.state}`
      );
    }

    const sequence = current.version + 1;
    const recordedAt = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO native_event_entries
          (id, event_id, sequence, kind, state, title, body, affected_components_json,
           occurred_at, recorded_at, actor_id)
         VALUES (?, ?, ?, 'update', ?, ?, ?, ?, ?, ?, ?)`
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
        audit.actorId
      );
    database
      .prepare(`UPDATE native_events SET state = ?, version = ?, updated_at = ? WHERE id = ?`)
      .run(input.state, sequence, recordedAt, eventId);
    writeEventAudit(database, audit, 'incident.update', eventId, {
      version: sequence,
      state: input.state,
    });
    return getIncident(database, eventId) as IncidentRecord;
  })();
};

const matchingSubscriptions = (
  database: Database.Database,
  event: PublishableEventRecord
): SubscriptionRow[] => {
  const rows = database
    .prepare(
      `SELECT id, incident_id, component_ids_json
       FROM email_subscriptions
       WHERE page_id = ? AND state = 'active' AND (incident_id IS NULL OR incident_id = ?)`
    )
    .all(event.pageId, event.id) as SubscriptionRow[];
  const affected = new Set(event.latestEntry.affectedComponentIds);
  return rows.filter(row => {
    if (row.incident_id === event.id) return true;
    const components = JSON.parse(row.component_ids_json) as string[];
    return components.length === 0 || components.some(component => affected.has(component));
  });
};

export const getPublicationReview = (
  database: Database.Database,
  eventId: string,
  expectedVersion: number
): PublicationReview => {
  const incident = getIncident(database, eventId);
  if (!incident) throw eventError('event_not_found', 'Incident does not exist');
  if (incident.version !== expectedVersion) {
    throw eventError(
      'event_version_conflict',
      `Expected version ${expectedVersion}, active version is ${incident.version}`
    );
  }
  return { incident, estimatedRecipients: matchingSubscriptions(database, incident).length };
};

export const getNativePublicationReview = <T extends PublishableEventRecord>(
  database: Database.Database,
  event: T | null,
  expectedVersion: number
): NativePublicationReview<T> => {
  if (!event) throw eventError('event_not_found', 'Native event does not exist');
  if (event.version !== expectedVersion) {
    throw eventError(
      'event_version_conflict',
      `Expected version ${expectedVersion}, active version is ${event.version}`
    );
  }
  return { event, estimatedRecipients: matchingSubscriptions(database, event).length };
};

export const publishNativeEvent = <T extends PublishableEventRecord>(
  database: Database.Database,
  loadEvent: () => T | null,
  input: {
    eventId: string;
    expectedVersion: number;
    notifySubscribers: boolean;
    expectedRecipients: number;
    piiProtector?: PiiProtector;
  },
  audit: AuditContext
): PublicationSnapshot =>
  database.transaction(() => {
    const review = getNativePublicationReview(database, loadEvent(), input.expectedVersion);
    if (review.estimatedRecipients !== input.expectedRecipients) {
      throw eventError(
        'publication_review_stale',
        'Eligible subscriber count changed after review'
      );
    }
    const duplicate = database
      .prepare(`SELECT 1 FROM event_publications WHERE event_id = ? AND event_sequence = ?`)
      .get(input.eventId, input.expectedVersion);
    if (duplicate) {
      throw eventError(
        'event_sequence_already_published',
        'Native event version is already published'
      );
    }

    const publicationId = randomUUID();
    const publishedAt = new Date().toISOString();
    const snapshot = publicationSnapshotSchema.parse({
      publicationId,
      eventId: review.event.id,
      eventSequence: review.event.version,
      type: review.event.type,
      pageId: review.event.pageId,
      title: review.event.title,
      state: review.event.state,
      body: review.event.latestEntry.body,
      affectedComponentIds: review.event.latestEntry.affectedComponentIds,
      occurredAt: review.event.latestEntry.occurredAt,
      recordedAt: review.event.latestEntry.recordedAt,
      publishedAt,
      ...review.event.publicationDetails,
    });
    const subscriptions = matchingSubscriptions(database, review.event);
    database
      .prepare(
        `INSERT INTO event_publications
          (id, event_id, event_sequence, page_id, content_json, notify_subscribers,
           subscriber_scope_json, estimated_recipients, actor_id, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        publicationId,
        input.eventId,
        input.expectedVersion,
        review.event.pageId,
        JSON.stringify(snapshot),
        input.notifySubscribers ? 1 : 0,
        JSON.stringify({ subscriptionIds: subscriptions.map(item => item.id) }),
        subscriptions.length,
        audit.actorId,
        publishedAt
      );

    if (input.notifySubscribers) {
      if (subscriptions.length > 0 && !input.piiProtector) {
        throw eventError(
          'subscriber_encryption_unavailable',
          'Subscriber delivery encryption is unavailable'
        );
      }
      const enqueue = database.prepare(
        `INSERT INTO notification_outbox
          (id, publication_id, subscription_id, channel, kind, idempotency_key,
           state, next_attempt_at, payload_ciphertext, created_at)
         VALUES (?, ?, ?, 'email', 'event_publication', ?, 'queued', ?, ?, ?)`
      );
      const insertToken = database.prepare(
        `INSERT INTO subscription_tokens
          (id, subscription_id, purpose, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const subscription of subscriptions) {
        const manageToken = randomBytes(32).toString('base64url');
        const unsubscribeToken = randomBytes(32).toString('base64url');
        const tokenExpiry = new Date(
          Date.parse(publishedAt) + 365 * 24 * 60 * 60_000
        ).toISOString();
        insertToken.run(
          randomUUID(),
          subscription.id,
          'manage',
          input.piiProtector?.tokenHash(manageToken),
          tokenExpiry,
          publishedAt
        );
        insertToken.run(
          randomUUID(),
          subscription.id,
          'unsubscribe',
          input.piiProtector?.tokenHash(unsubscribeToken),
          tokenExpiry,
          publishedAt
        );
        enqueue.run(
          randomUUID(),
          publicationId,
          subscription.id,
          `${publicationId}:${subscription.id}:email`,
          publishedAt,
          input.piiProtector?.encrypt(JSON.stringify({ manageToken, unsubscribeToken })),
          publishedAt
        );
      }
    }
    writeEventAudit(database, audit, `${review.event.type}.publish`, input.eventId, {
      publicationId,
      eventSequence: input.expectedVersion,
      notifySubscribers: input.notifySubscribers,
      estimatedRecipients: subscriptions.length,
    });
    return snapshot;
  })();

export const publishIncident = (
  database: Database.Database,
  input: {
    eventId: string;
    expectedVersion: number;
    notifySubscribers: boolean;
    expectedRecipients: number;
    piiProtector?: PiiProtector;
  },
  audit: AuditContext
): IncidentPublicationSnapshot =>
  incidentPublicationSnapshotSchema.parse(
    publishNativeEvent(database, () => getIncident(database, input.eventId), input, audit)
  );

export const listPublishedIncidents = (
  database: Database.Database,
  pageId: string,
  limit = 100
): IncidentPublicationSnapshot[] => {
  const rows = database
    .prepare(
      `SELECT content_json FROM event_publications
       WHERE page_id = ? ORDER BY published_at DESC LIMIT ?`
    )
    .all(pageId, Math.min(Math.max(limit, 1), 100)) as Array<{ content_json: string }>;
  return rows
    .map(row => publicationSnapshotSchema.parse(JSON.parse(row.content_json)))
    .filter((item): item is IncidentPublicationSnapshot => item.type === 'incident');
};

export const getPublishedIncident = (
  database: Database.Database,
  pageId: string,
  eventId: string
): IncidentPublicationSnapshot[] => {
  const rows = database
    .prepare(
      `SELECT content_json FROM event_publications
       WHERE page_id = ? AND event_id = ? ORDER BY event_sequence ASC`
    )
    .all(pageId, eventId) as Array<{ content_json: string }>;
  return rows
    .map(row => publicationSnapshotSchema.parse(JSON.parse(row.content_json)))
    .filter((item): item is IncidentPublicationSnapshot => item.type === 'incident');
};

export const listPublishedEvents = (
  database: Database.Database,
  pageId: string,
  limit = 100
): PublicationSnapshot[] => {
  const rows = database
    .prepare(
      `SELECT content_json FROM event_publications
       WHERE page_id = ? ORDER BY published_at DESC LIMIT ?`
    )
    .all(pageId, Math.min(Math.max(limit, 1), 100)) as Array<{ content_json: string }>;
  return rows.map(row => publicationSnapshotSchema.parse(JSON.parse(row.content_json)));
};

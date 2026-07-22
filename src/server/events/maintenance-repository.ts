import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuditContext } from '../config/managed-config.js';
import type { PiiProtector } from '../subscriptions/crypto.js';
import {
  maintenanceCreateSchema,
  maintenancePublicationSnapshotSchema,
  maintenanceUpdateSchema,
  maintenanceWindowSchema,
  publicationSnapshotSchema,
  type MaintenanceCreateInput,
  type MaintenancePublicationSnapshot,
  type MaintenanceState,
  type MaintenanceUpdateInput,
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

interface MaintenanceRow {
  id: string;
  type: string;
  page_id: string;
  title: string;
  state: MaintenanceState;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  request_hash: string;
  details_json: string;
}

interface MaintenanceEntryRow {
  sequence: number;
  state: MaintenanceState;
  title: string;
  body: string;
  affected_components_json: string;
  occurred_at: string;
  recorded_at: string;
  actor_id: string;
  details_json: string;
}

interface MaintenanceDetails {
  scheduledStartAt: string;
  scheduledEndAt: string;
}

export interface MaintenanceRecord extends PublishableEventRecord {
  type: 'maintenance';
  state: MaintenanceState;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  latestEntry: PublishableEventRecord['latestEntry'] & {
    state: MaintenanceState;
    title: string;
    actorId: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
  };
}

const parseDetails = (value: string): MaintenanceDetails =>
  maintenanceWindowSchema.parse(JSON.parse(value));

const getMaintenanceEntry = (
  database: Database.Database,
  eventId: string,
  sequence: number
): MaintenanceRecord['latestEntry'] => {
  const row = database
    .prepare(
      `SELECT sequence, state, title, body, affected_components_json,
              occurred_at, recorded_at, actor_id, details_json
       FROM native_event_entries
       WHERE event_id = ? AND sequence = ?`
    )
    .get(eventId, sequence) as MaintenanceEntryRow | undefined;
  if (!row) throw eventError('event_entry_missing', 'Maintenance entry does not exist');
  const details = parseDetails(row.details_json);
  return {
    sequence: row.sequence,
    state: row.state,
    title: row.title,
    body: row.body,
    affectedComponentIds: JSON.parse(row.affected_components_json) as string[],
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    actorId: row.actor_id,
    ...details,
  };
};

const parseMaintenance = (database: Database.Database, row: MaintenanceRow): MaintenanceRecord => {
  const details = parseDetails(row.details_json);
  return {
    id: row.id,
    type: 'maintenance',
    pageId: row.page_id,
    title: row.title,
    state: row.state,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...details,
    publicationDetails: {
      scheduledStartAt: details.scheduledStartAt,
      scheduledEndAt: details.scheduledEndAt,
    },
    latestEntry: getMaintenanceEntry(database, row.id, row.version),
  };
};

const maintenanceColumns = `
  id, type, page_id, title, state, version, created_by, created_at,
  updated_at, request_hash, details_json`;

export const getMaintenance = (
  database: Database.Database,
  eventId: string
): MaintenanceRecord | null => {
  const row = database
    .prepare(
      `SELECT ${maintenanceColumns} FROM native_events WHERE id = ? AND type = 'maintenance'`
    )
    .get(eventId) as MaintenanceRow | undefined;
  return row ? parseMaintenance(database, row) : null;
};

export const listMaintenances = (database: Database.Database, limit = 100): MaintenanceRecord[] => {
  const rows = database
    .prepare(
      `SELECT ${maintenanceColumns} FROM native_events
       WHERE type = 'maintenance' ORDER BY updated_at DESC LIMIT ?`
    )
    .all(Math.min(Math.max(limit, 1), 100)) as MaintenanceRow[];
  return rows.map(row => parseMaintenance(database, row));
};

export const createMaintenance = (
  database: Database.Database,
  rawInput: MaintenanceCreateInput,
  idempotencyKey: string,
  audit: AuditContext
): MaintenanceRecord => {
  const input = maintenanceCreateSchema.parse(rawInput);
  const requestHash = hashInput(input);
  return database.transaction(() => {
    const existing = database
      .prepare(
        `SELECT ${maintenanceColumns} FROM native_events
         WHERE created_by = ? AND idempotency_key = ?`
      )
      .get(audit.actorId, idempotencyKey) as MaintenanceRow | undefined;
    if (existing) {
      if (existing.type !== 'maintenance' || existing.request_hash !== requestHash) {
        throw eventError(
          'idempotency_key_reused',
          'Idempotency key was already used for another request'
        );
      }
      return parseMaintenance(database, existing);
    }

    const id = randomUUID();
    const recordedAt = new Date().toISOString();
    const details = {
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
    };
    database
      .prepare(
        `INSERT INTO native_events
          (id, type, page_id, title, state, version, created_by, idempotency_key,
           request_hash, created_at, updated_at, details_json)
         VALUES (?, 'maintenance', ?, ?, 'draft', 1, ?, ?, ?, ?, ?, ?)`
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
    writeEventAudit(database, audit, 'maintenance.create', id, {
      version: 1,
      state: 'draft',
      pageId: input.pageId,
      ...details,
    });
    return getMaintenance(database, id) as MaintenanceRecord;
  })();
};

const allowedTransitions: Record<MaintenanceState, MaintenanceState[]> = {
  draft: ['draft', 'scheduled', 'cancelled'],
  scheduled: ['scheduled', 'in_progress', 'cancelled'],
  in_progress: ['in_progress', 'completed', 'cancelled'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

export const appendMaintenanceUpdate = (
  database: Database.Database,
  eventId: string,
  rawInput: MaintenanceUpdateInput,
  audit: AuditContext
): MaintenanceRecord => {
  const input = maintenanceUpdateSchema.parse(rawInput);
  return database.transaction(() => {
    const current = getMaintenance(database, eventId);
    if (!current) throw eventError('event_not_found', 'Maintenance does not exist');
    if (current.version !== input.expectedVersion) {
      throw eventError(
        'event_version_conflict',
        `Expected version ${input.expectedVersion}, active version is ${current.version}`
      );
    }
    if (!allowedTransitions[current.state].includes(input.state)) {
      throw eventError(
        'invalid_event_transition',
        `Cannot transition maintenance from ${current.state} to ${input.state}`
      );
    }
    const details = maintenanceWindowSchema.parse({
      scheduledStartAt: input.scheduledStartAt ?? current.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt ?? current.scheduledEndAt,
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
    writeEventAudit(database, audit, 'maintenance.update', eventId, {
      version: sequence,
      state: input.state,
      ...details,
    });
    return getMaintenance(database, eventId) as MaintenanceRecord;
  })();
};

export const getMaintenancePublicationReview = (
  database: Database.Database,
  eventId: string,
  expectedVersion: number
): NativePublicationReview<MaintenanceRecord> =>
  getNativePublicationReview(database, getMaintenance(database, eventId), expectedVersion);

export const publishMaintenance = (
  database: Database.Database,
  input: {
    eventId: string;
    expectedVersion: number;
    notifySubscribers: boolean;
    expectedRecipients: number;
    piiProtector?: PiiProtector;
  },
  audit: AuditContext
): MaintenancePublicationSnapshot =>
  maintenancePublicationSnapshotSchema.parse(
    publishNativeEvent(database, () => getMaintenance(database, input.eventId), input, audit)
  );

export const listPublishedMaintenances = (
  database: Database.Database,
  pageId: string,
  limit = 100
): MaintenancePublicationSnapshot[] => {
  const rows = database
    .prepare(
      `SELECT content_json FROM event_publications
       WHERE page_id = ? ORDER BY published_at DESC LIMIT ?`
    )
    .all(pageId, Math.min(Math.max(limit, 1), 100)) as Array<{ content_json: string }>;
  return rows
    .map(row => publicationSnapshotSchema.parse(JSON.parse(row.content_json)))
    .filter((item): item is MaintenancePublicationSnapshot => item.type === 'maintenance');
};

export const getPublishedMaintenance = (
  database: Database.Database,
  pageId: string,
  eventId: string
): MaintenancePublicationSnapshot[] => {
  const rows = database
    .prepare(
      `SELECT content_json FROM event_publications
       WHERE page_id = ? AND event_id = ? ORDER BY event_sequence ASC`
    )
    .all(pageId, eventId) as Array<{ content_json: string }>;
  return rows
    .map(row => publicationSnapshotSchema.parse(JSON.parse(row.content_json)))
    .filter((item): item is MaintenancePublicationSnapshot => item.type === 'maintenance');
};

import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuditContext } from '../config/managed-config.js';
import {
  eventTemplateCreateSchema,
  eventTemplateUpdateSchema,
  type EventTemplateCreateInput,
  type EventTemplateState,
  type EventTemplateType,
  type EventTemplateUpdateInput,
} from './schemas.js';

const templateError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

const hashInput = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input), 'utf8').digest('hex');

interface EventTemplateRow {
  id: string;
  name: string;
  event_type: EventTemplateType;
  state: EventTemplateState;
  version: number;
  created_by: string;
  request_hash: string;
  created_at: string;
  updated_at: string;
}

interface EventTemplateEntryRow {
  sequence: number;
  state: EventTemplateState;
  name: string;
  title: string;
  body: string;
  affected_components_json: string;
  default_notify_subscribers: number;
  notice_kind: 'information' | 'warning' | null;
  recorded_at: string;
  actor_id: string;
}

export interface EventTemplateRecord {
  id: string;
  name: string;
  eventType: EventTemplateType;
  state: EventTemplateState;
  version: number;
  title: string;
  body: string;
  affectedComponentIds: string[];
  defaultNotifySubscribers: boolean;
  noticeKind: 'information' | 'warning' | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  latestEntry: {
    sequence: number;
    state: EventTemplateState;
    name: string;
    title: string;
    body: string;
    affectedComponentIds: string[];
    defaultNotifySubscribers: boolean;
    noticeKind: 'information' | 'warning' | null;
    recordedAt: string;
    actorId: string;
  };
}

export interface AppliedEventTemplate {
  id: string;
  version: number;
  defaultNotifySubscribers: boolean;
}

export const parseAppliedEventTemplate = (row: {
  source_template_id: string | null;
  source_template_version: number | null;
  source_template_notify_suggestion: number | null;
}): AppliedEventTemplate | null => {
  if (
    row.source_template_id === null &&
    row.source_template_version === null &&
    row.source_template_notify_suggestion === null
  ) {
    return null;
  }
  if (
    row.source_template_id === null ||
    row.source_template_version === null ||
    row.source_template_notify_suggestion === null
  ) {
    throw templateError(
      'event_template_attribution_invalid',
      'Event template attribution is incomplete'
    );
  }
  return {
    id: row.source_template_id,
    version: row.source_template_version,
    defaultNotifySubscribers: row.source_template_notify_suggestion === 1,
  };
};

const templateColumns = `
  id, name, event_type, state, version, created_by, request_hash, created_at, updated_at`;

const getEntry = (
  database: Database.Database,
  templateId: string,
  sequence: number
): EventTemplateRecord['latestEntry'] => {
  const row = database
    .prepare(
      `SELECT sequence, state, name, title, body, affected_components_json,
              default_notify_subscribers, notice_kind, recorded_at, actor_id
       FROM event_template_entries
       WHERE template_id = ? AND sequence = ?`
    )
    .get(templateId, sequence) as EventTemplateEntryRow | undefined;
  if (!row) {
    throw templateError('event_template_entry_missing', 'Event template entry is missing');
  }
  return {
    sequence: row.sequence,
    state: row.state,
    name: row.name,
    title: row.title,
    body: row.body,
    affectedComponentIds: JSON.parse(row.affected_components_json) as string[],
    defaultNotifySubscribers: row.default_notify_subscribers === 1,
    noticeKind: row.notice_kind,
    recordedAt: row.recorded_at,
    actorId: row.actor_id,
  };
};

const parseTemplate = (database: Database.Database, row: EventTemplateRow): EventTemplateRecord => {
  const latestEntry = getEntry(database, row.id, row.version);
  return {
    id: row.id,
    name: row.name,
    eventType: row.event_type,
    state: row.state,
    version: row.version,
    title: latestEntry.title,
    body: latestEntry.body,
    affectedComponentIds: latestEntry.affectedComponentIds,
    defaultNotifySubscribers: latestEntry.defaultNotifySubscribers,
    noticeKind: latestEntry.noticeKind,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestEntry,
  };
};

export const getEventTemplate = (
  database: Database.Database,
  templateId: string
): EventTemplateRecord | null => {
  const row = database
    .prepare(`SELECT ${templateColumns} FROM event_templates WHERE id = ?`)
    .get(templateId) as EventTemplateRow | undefined;
  return row ? parseTemplate(database, row) : null;
};

export const listEventTemplates = (
  database: Database.Database,
  state?: EventTemplateState,
  limit = 100
): EventTemplateRecord[] => {
  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  const rows = (
    state
      ? database
          .prepare(
            `SELECT ${templateColumns} FROM event_templates
             WHERE state = ? ORDER BY updated_at DESC, id ASC LIMIT ?`
          )
          .all(state, boundedLimit)
      : database
          .prepare(
            `SELECT ${templateColumns} FROM event_templates
             ORDER BY updated_at DESC, id ASC LIMIT ?`
          )
          .all(boundedLimit)
  ) as EventTemplateRow[];
  return rows.map(row => parseTemplate(database, row));
};

const templateNameOwner = (database: Database.Database, name: string): { id: string } | undefined =>
  database.prepare('SELECT id FROM event_templates WHERE name = ? COLLATE NOCASE').get(name) as
    | { id: string }
    | undefined;

const writeTemplateAudit = (
  database: Database.Database,
  audit: AuditContext,
  action: string,
  template: {
    id: string;
    eventType: EventTemplateType;
    state: EventTemplateState;
    version: number;
    defaultNotifySubscribers: boolean;
  }
) => {
  database
    .prepare(
      `INSERT INTO admin_audit
        (id, occurred_at, actor_id, action, target_type, target_id, request_id,
         ip_address, user_agent, result, after_json)
       VALUES (?, ?, ?, ?, 'event_template', ?, ?, ?, ?, 'success', ?)`
    )
    .run(
      randomUUID(),
      new Date().toISOString(),
      audit.actorId,
      action,
      template.id,
      audit.requestId,
      audit.ipAddress ?? null,
      audit.userAgent ?? null,
      JSON.stringify({
        eventType: template.eventType,
        state: template.state,
        version: template.version,
        defaultNotifySubscribers: template.defaultNotifySubscribers,
      })
    );
};

const insertEntry = (
  database: Database.Database,
  templateId: string,
  sequence: number,
  state: EventTemplateState,
  input: EventTemplateCreateInput,
  recordedAt: string,
  actorId: string
) => {
  database
    .prepare(
      `INSERT INTO event_template_entries
        (id, template_id, sequence, state, name, title, body, affected_components_json,
         default_notify_subscribers, notice_kind, recorded_at, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      templateId,
      sequence,
      state,
      input.name,
      input.title,
      input.body,
      JSON.stringify(input.affectedComponentIds),
      input.defaultNotifySubscribers ? 1 : 0,
      input.noticeKind,
      recordedAt,
      actorId
    );
};

export const createEventTemplate = (
  database: Database.Database,
  rawInput: EventTemplateCreateInput,
  idempotencyKey: string,
  audit: AuditContext
): EventTemplateRecord => {
  const input = eventTemplateCreateSchema.parse(rawInput);
  const requestHash = hashInput(input);
  return database.transaction(() => {
    const existing = database
      .prepare(
        `SELECT ${templateColumns} FROM event_templates
         WHERE created_by = ? AND idempotency_key = ?`
      )
      .get(audit.actorId, idempotencyKey) as EventTemplateRow | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw templateError(
          'idempotency_key_reused',
          'Idempotency key was already used for another request'
        );
      }
      return parseTemplate(database, existing);
    }
    if (templateNameOwner(database, input.name)) {
      throw templateError('event_template_name_conflict', 'Event template name is already in use');
    }

    const id = randomUUID();
    const recordedAt = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO event_templates
          (id, name, event_type, state, version, created_by, idempotency_key,
           request_hash, created_at, updated_at)
         VALUES (?, ?, ?, 'active', 1, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name,
        input.eventType,
        audit.actorId,
        idempotencyKey,
        requestHash,
        recordedAt,
        recordedAt
      );
    insertEntry(database, id, 1, 'active', input, recordedAt, audit.actorId);
    const created = getEventTemplate(database, id) as EventTemplateRecord;
    writeTemplateAudit(database, audit, 'event_template.create', created);
    return created;
  })();
};

export const appendEventTemplateUpdate = (
  database: Database.Database,
  templateId: string,
  rawInput: EventTemplateUpdateInput,
  audit: AuditContext
): EventTemplateRecord => {
  const input = eventTemplateUpdateSchema.parse(rawInput);
  return database.transaction(() => {
    const current = getEventTemplate(database, templateId);
    if (!current) {
      throw templateError('event_template_not_found', 'Event template does not exist');
    }
    if (current.version !== input.expectedVersion) {
      throw templateError(
        'event_template_version_conflict',
        `Expected version ${input.expectedVersion}, active version is ${current.version}`
      );
    }
    if (current.eventType !== input.eventType) {
      throw templateError('event_template_type_conflict', 'Event template type cannot be changed');
    }
    const nameOwner = templateNameOwner(database, input.name);
    if (nameOwner && nameOwner.id !== templateId) {
      throw templateError('event_template_name_conflict', 'Event template name is already in use');
    }

    const version = current.version + 1;
    const recordedAt = new Date().toISOString();
    insertEntry(database, templateId, version, input.state, input, recordedAt, audit.actorId);
    database
      .prepare(
        `UPDATE event_templates
         SET name = ?, state = ?, version = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(input.name, input.state, version, recordedAt, templateId);
    const updated = getEventTemplate(database, templateId) as EventTemplateRecord;
    writeTemplateAudit(database, audit, 'event_template.update', updated);
    return updated;
  })();
};

export const resolveEventTemplateApplication = (
  database: Database.Database,
  reference: { id: string; version: number } | undefined,
  eventType: EventTemplateType
): AppliedEventTemplate | null => {
  if (!reference) return null;
  const template = getEventTemplate(database, reference.id);
  if (!template) {
    throw templateError('event_template_not_found', 'Event template does not exist');
  }
  if (template.version !== reference.version) {
    throw templateError(
      'event_template_version_conflict',
      `Expected template version ${reference.version}, active version is ${template.version}`
    );
  }
  if (template.eventType !== eventType) {
    throw templateError(
      'event_template_type_conflict',
      'Event template type does not match the draft'
    );
  }
  if (template.state !== 'active') {
    throw templateError(
      'event_template_archived',
      'Archived event templates cannot start new drafts'
    );
  }
  return {
    id: template.id,
    version: template.version,
    defaultNotifySubscribers: template.defaultNotifySubscribers,
  };
};

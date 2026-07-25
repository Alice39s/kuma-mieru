import type Database from 'better-sqlite3';
import { z } from 'zod';

export type AdminAuditResult = 'success' | 'denied' | 'failed';

export interface AdminAuditEntry {
  id: string;
  occurredAt: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  result: AdminAuditResult;
  errorCode: string | null;
}

export interface AdminAuditPage {
  entries: AdminAuditEntry[];
  nextCursor: string | null;
}

export interface AdminAuditQuery {
  limit: number;
  cursor?: string;
  action?: string;
  result?: AdminAuditResult;
}

const cursorSchema = z
  .object({
    version: z.literal(1),
    occurredAt: z.iso.datetime(),
    id: z.string().min(1).max(200),
    action: z.string().min(1).max(200).nullable(),
    result: z.enum(['success', 'denied', 'failed']).nullable(),
  })
  .strict();

type AuditRow = {
  id: string;
  occurred_at: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  result: AdminAuditResult;
  error_code: string | null;
};

const auditError = (code: string, message: string) => Object.assign(new Error(message), { code });

export const adminAuditErrorCode = (error: unknown) =>
  typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'admin_audit_failed';

const decodeCursor = (cursor: string) => {
  if (cursor.length > 1_024 || !/^[A-Za-z0-9_-]+$/u.test(cursor)) {
    throw auditError('admin_audit_cursor_invalid', 'Admin audit cursor is invalid');
  }
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw auditError('admin_audit_cursor_invalid', 'Admin audit cursor is invalid');
  }
};

const encodeCursor = (entry: AdminAuditEntry, query: AdminAuditQuery) =>
  Buffer.from(
    JSON.stringify({
      version: 1,
      occurredAt: entry.occurredAt,
      id: entry.id,
      action: query.action ?? null,
      result: query.result ?? null,
    }),
    'utf8'
  ).toString('base64url');

const mapEntry = (row: AuditRow): AdminAuditEntry => ({
  id: row.id,
  occurredAt: row.occurred_at,
  actorId: row.actor_id,
  action: row.action,
  targetType: row.target_type,
  targetId: row.target_id,
  result: row.result,
  errorCode: row.error_code,
});

export const listAdminAudit = (
  database: Database.Database,
  query: AdminAuditQuery
): AdminAuditPage => {
  const conditions: string[] = [];
  const parameters: Array<string | number> = [];
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    if (cursor.action !== (query.action ?? null) || cursor.result !== (query.result ?? null)) {
      throw auditError(
        'admin_audit_cursor_filter_mismatch',
        'Admin audit cursor does not match the active filters'
      );
    }
    conditions.push('(occurred_at < ? OR (occurred_at = ? AND id < ?))');
    parameters.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
  }
  if (query.action) {
    conditions.push('action = ?');
    parameters.push(query.action);
  }
  if (query.result) {
    conditions.push('result = ?');
    parameters.push(query.result);
  }
  const rows = database
    .prepare(
      `SELECT id, occurred_at, actor_id, action, target_type, target_id, result, error_code
       FROM admin_audit
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?`
    )
    .all(...parameters, query.limit + 1) as AuditRow[];
  const entries = rows.slice(0, query.limit).map(mapEntry);
  return {
    entries,
    nextCursor:
      rows.length > query.limit && entries.length > 0
        ? encodeCursor(entries[entries.length - 1], query)
        : null,
  };
};

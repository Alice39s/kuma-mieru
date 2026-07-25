import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuditContext } from '../config/managed-config.js';

export interface AdminPasskey {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: string | null;
}

export interface RenameAdminPasskeyInput {
  userId: string;
  passkeyId: string;
  expectedName: string | null;
  name: string;
  audit: AuditContext;
}

export interface DeleteAdminPasskeyInput {
  userId: string;
  passkeyId: string;
  expectedName: string | null;
  audit: AuditContext;
}

type PasskeyRow = {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: number | boolean;
  createdAt: string | number | Date | null;
};

const passkeyError = (code: string, message: string) => Object.assign(new Error(message), { code });

export const passkeyAdminErrorCode = (error: unknown) =>
  typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'passkey_admin_failed';

const storedDate = (value: PasskeyRow['createdAt']) => {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw passkeyError('passkey_date_invalid', 'Stored passkey date is invalid');
  }
  return date.toISOString();
};

const mapPasskey = (row: PasskeyRow): AdminPasskey => ({
  id: row.id,
  name: row.name,
  deviceType: row.deviceType,
  backedUp: Boolean(row.backedUp),
  createdAt: storedDate(row.createdAt),
});

const writeAudit = (
  database: Database.Database,
  audit: AuditContext,
  action: string,
  passkeyId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
) => {
  database
    .prepare(
      `INSERT INTO admin_audit
        (id, occurred_at, actor_id, action, target_type, target_id, request_id,
         ip_address, user_agent, result, before_json, after_json)
       VALUES (?, ?, ?, ?, 'passkey', ?, ?, ?, ?, 'success', ?, ?)`
    )
    .run(
      randomUUID(),
      new Date().toISOString(),
      audit.actorId,
      action,
      passkeyId,
      audit.requestId,
      audit.ipAddress ?? null,
      audit.userAgent ?? null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null
    );
};

const selectOwnedPasskey = (database: Database.Database, userId: string, passkeyId: string) =>
  database
    .prepare(
      `SELECT id, name, deviceType, backedUp, createdAt
       FROM "passkey"
       WHERE id = ? AND userId = ?`
    )
    .get(passkeyId, userId) as PasskeyRow | undefined;

export const listAdminPasskeys = (database: Database.Database, userId: string): AdminPasskey[] =>
  (
    database
      .prepare(
        `SELECT id, name, deviceType, backedUp, createdAt
         FROM "passkey"
         WHERE userId = ?
         ORDER BY createdAt DESC, id DESC`
      )
      .all(userId) as PasskeyRow[]
  ).map(mapPasskey);

export const recordAdminPasskeyRegistration = (
  database: Database.Database,
  userId: string,
  passkeyId: string,
  audit: AuditContext
) =>
  database.transaction(() => {
    const row = selectOwnedPasskey(database, userId, passkeyId);
    if (!row) {
      throw passkeyError('passkey_not_found', 'Registered passkey is unavailable');
    }
    writeAudit(database, audit, 'auth.passkey.register', passkeyId, null, {
      deviceType: row.deviceType,
      backedUp: Boolean(row.backedUp),
    });
    return mapPasskey(row);
  })();

export const renameAdminPasskey = (database: Database.Database, input: RenameAdminPasskeyInput) =>
  database.transaction(() => {
    const row = selectOwnedPasskey(database, input.userId, input.passkeyId);
    if (!row) throw passkeyError('passkey_not_found', 'Passkey does not exist');
    if (row.name !== input.expectedName) {
      throw passkeyError('passkey_name_conflict', 'Passkey name changed before this request');
    }
    if (row.name === input.name) {
      throw passkeyError('passkey_name_unchanged', 'Passkey already has this name');
    }
    const updated = database
      .prepare(
        `UPDATE "passkey"
         SET name = ?
         WHERE id = ? AND userId = ?
           AND ((name IS NULL AND ? IS NULL) OR name = ?)`
      )
      .run(input.name, input.passkeyId, input.userId, input.expectedName, input.expectedName);
    if (updated.changes !== 1) {
      throw passkeyError('passkey_name_conflict', 'Passkey name changed before this request');
    }
    writeAudit(
      database,
      input.audit,
      'auth.passkey.rename',
      input.passkeyId,
      { named: Boolean(row.name) },
      { named: true }
    );
    const result = selectOwnedPasskey(database, input.userId, input.passkeyId);
    if (!result) throw passkeyError('passkey_not_found', 'Passkey does not exist');
    return mapPasskey(result);
  })();

export const deleteAdminPasskey = (database: Database.Database, input: DeleteAdminPasskeyInput) =>
  database.transaction(() => {
    const row = selectOwnedPasskey(database, input.userId, input.passkeyId);
    if (!row) throw passkeyError('passkey_not_found', 'Passkey does not exist');
    if (row.name !== input.expectedName) {
      throw passkeyError('passkey_name_conflict', 'Passkey name changed before this request');
    }
    const removed = database
      .prepare(
        `DELETE FROM "passkey"
         WHERE id = ? AND userId = ?
           AND ((name IS NULL AND ? IS NULL) OR name = ?)`
      )
      .run(input.passkeyId, input.userId, input.expectedName, input.expectedName);
    if (removed.changes !== 1) {
      throw passkeyError('passkey_delete_conflict', 'Passkey changed before this request');
    }
    writeAudit(
      database,
      input.audit,
      'auth.passkey.delete',
      input.passkeyId,
      {
        deviceType: row.deviceType,
        backedUp: Boolean(row.backedUp),
      },
      null
    );
    return { passkeyId: input.passkeyId, deleted: true as const };
  })();

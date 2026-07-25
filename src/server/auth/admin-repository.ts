import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuditContext } from '../config/managed-config.js';
import type { AdminRole, KumaAuth } from './auth.js';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: AdminRole;
  createdAt: string;
  updatedAt: string;
  activeSessionCount: number;
  passkeyCount: number;
}

export interface AdminUserSession {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface CreateAdminUserInput {
  name: string;
  email: string;
  password: string;
  role: AdminRole;
  audit: AuditContext;
}

export interface ChangeAdminUserRoleInput {
  actorUserId: string;
  userId: string;
  expectedRole: AdminRole;
  role: AdminRole;
  audit: AuditContext;
}

export interface RevokeAdminUserSessionInput {
  currentSessionId: string;
  userId: string;
  sessionId: string;
  audit: AuditContext;
}

type DateValue = Date | number | string;

interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: number | boolean;
  role: AdminRole;
  createdAt: DateValue;
  updatedAt: DateValue;
}

interface SessionRow {
  id: string;
  userId: string;
  createdAt: DateValue;
  updatedAt: DateValue;
  expiresAt: DateValue;
}

const adminAuthError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

export const adminAuthErrorCode = (error: unknown) =>
  typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'admin_auth_failed';

const toIsoString = (value: DateValue) => {
  const date =
    value instanceof Date ? value : typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw adminAuthError('admin_auth_date_invalid', 'Stored authentication date is invalid');
  }
  return date.toISOString();
};

const isActive = (value: DateValue, now: Date) => Date.parse(toIsoString(value)) > now.valueOf();

const selectUser = (database: Database.Database, userId: string) =>
  database
    .prepare(
      `SELECT id, name, email, emailVerified, role, createdAt, updatedAt
       FROM "user"
       WHERE id = ?`
    )
    .get(userId) as UserRow | undefined;

const userSessionCounts = (database: Database.Database, now: Date) => {
  const counts = new Map<string, number>();
  const rows = database.prepare('SELECT userId, expiresAt FROM "session"').all() as Array<{
    userId: string;
    expiresAt: DateValue;
  }>;
  for (const row of rows) {
    if (!isActive(row.expiresAt, now)) continue;
    counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
  }
  return counts;
};

const userPasskeyCounts = (database: Database.Database) => {
  const rows = database
    .prepare('SELECT userId, COUNT(*) AS count FROM "passkey" GROUP BY userId')
    .all() as Array<{ userId: string; count: number }>;
  return new Map(rows.map(row => [row.userId, row.count]));
};

const mapUser = (
  row: UserRow,
  activeSessionCounts: Map<string, number>,
  passkeyCounts: Map<string, number>
): AdminUser => ({
  id: row.id,
  name: row.name,
  email: row.email,
  emailVerified: Boolean(row.emailVerified),
  role: row.role,
  createdAt: toIsoString(row.createdAt),
  updatedAt: toIsoString(row.updatedAt),
  activeSessionCount: activeSessionCounts.get(row.id) ?? 0,
  passkeyCount: passkeyCounts.get(row.id) ?? 0,
});

const mapSession = (row: SessionRow, currentSessionId: string): AdminUserSession => ({
  id: row.id,
  userId: row.userId,
  createdAt: toIsoString(row.createdAt),
  updatedAt: toIsoString(row.updatedAt),
  expiresAt: toIsoString(row.expiresAt),
  current: row.id === currentSessionId,
});

const writeAudit = (
  database: Database.Database,
  audit: AuditContext,
  action: string,
  targetType: 'user' | 'session',
  targetId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
) => {
  database
    .prepare(
      `INSERT INTO admin_audit
        (id, occurred_at, actor_id, action, target_type, target_id, request_id,
         ip_address, user_agent, result, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?)`
    )
    .run(
      randomUUID(),
      new Date().toISOString(),
      audit.actorId,
      action,
      targetType,
      targetId,
      audit.requestId,
      audit.ipAddress ?? null,
      audit.userAgent ?? null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null
    );
};

export const listAdminUsers = (database: Database.Database, now = new Date()): AdminUser[] => {
  const rows = database
    .prepare(
      `SELECT id, name, email, emailVerified, role, createdAt, updatedAt
       FROM "user"
       ORDER BY createdAt ASC, id ASC`
    )
    .all() as UserRow[];
  const activeSessionCounts = userSessionCounts(database, now);
  const passkeyCounts = userPasskeyCounts(database);
  return rows.map(row => mapUser(row, activeSessionCounts, passkeyCounts));
};

export const listAdminUserSessions = (
  database: Database.Database,
  userId: string,
  currentSessionId: string,
  now = new Date()
): AdminUserSession[] => {
  if (!selectUser(database, userId)) {
    throw adminAuthError('admin_user_not_found', 'User does not exist');
  }
  return (
    database
      .prepare(
        `SELECT id, userId, createdAt, updatedAt, expiresAt
         FROM "session"
         WHERE userId = ?
         ORDER BY createdAt DESC, id DESC`
      )
      .all(userId) as SessionRow[]
  )
    .filter(row => isActive(row.expiresAt, now))
    .map(row => mapSession(row, currentSessionId));
};

export const createAdminUser = async (
  database: Database.Database,
  auth: KumaAuth,
  input: CreateAdminUserInput
): Promise<AdminUser> => {
  const email = input.email.trim().toLowerCase();
  const existing = database.prepare('SELECT id FROM "user" WHERE email = ?').get(email);
  if (existing) {
    throw adminAuthError('admin_user_email_conflict', 'A user with this email already exists');
  }

  let userId: string | null = null;
  try {
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser({
      email,
      name: input.name.trim(),
      emailVerified: true,
      role: input.role,
    });
    userId = user.id;
    const password = await context.password.hash(input.password);
    await context.internalAdapter.linkAccount({
      accountId: user.id,
      providerId: 'credential',
      password,
      userId: user.id,
    });
    writeAudit(database, input.audit, 'auth.user.create', 'user', user.id, null, {
      role: input.role,
    });
    const row = selectUser(database, user.id);
    if (!row) throw adminAuthError('admin_user_create_failed', 'Created user is unavailable');
    return mapUser(row, new Map(), new Map());
  } catch (error) {
    if (userId) {
      const context = await auth.$context;
      await context.internalAdapter.deleteUser(userId);
    }
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      error.code === 'SQLITE_CONSTRAINT_UNIQUE'
    ) {
      throw adminAuthError('admin_user_email_conflict', 'A user with this email already exists');
    }
    throw error;
  }
};

export const changeAdminUserRole = (database: Database.Database, input: ChangeAdminUserRoleInput) =>
  database.transaction(() => {
    if (input.actorUserId === input.userId) {
      throw adminAuthError(
        'admin_self_role_change_forbidden',
        'Use another owner to change your role'
      );
    }
    const row = selectUser(database, input.userId);
    if (!row) throw adminAuthError('admin_user_not_found', 'User does not exist');
    if (row.role !== input.expectedRole) {
      throw adminAuthError('admin_user_role_conflict', 'User role changed before this request');
    }
    if (row.role === input.role) {
      throw adminAuthError('admin_user_role_unchanged', 'User already has this role');
    }
    if (row.role === 'owner' && input.role !== 'owner') {
      const ownerCount = (
        database.prepare(`SELECT COUNT(*) AS count FROM "user" WHERE role = 'owner'`).get() as {
          count: number;
        }
      ).count;
      if (ownerCount <= 1) {
        throw adminAuthError('admin_last_owner_forbidden', 'The final owner cannot be demoted');
      }
    }
    const update = database
      .prepare(
        `UPDATE "user"
         SET role = ?, updatedAt = ?
         WHERE id = ? AND role = ?`
      )
      .run(input.role, new Date().toISOString(), input.userId, input.expectedRole);
    if (update.changes !== 1) {
      throw adminAuthError('admin_user_role_conflict', 'User role changed before this request');
    }
    const revokedSessions = database
      .prepare('DELETE FROM "session" WHERE userId = ?')
      .run(input.userId).changes;
    writeAudit(
      database,
      input.audit,
      'auth.user.role.change',
      'user',
      input.userId,
      { role: row.role },
      { role: input.role, revokedSessions }
    );
    const updated = selectUser(database, input.userId);
    if (!updated) throw adminAuthError('admin_user_not_found', 'User does not exist');
    return {
      user: mapUser(updated, new Map(), userPasskeyCounts(database)),
      revokedSessions,
    };
  })();

export const revokeAdminUserSession = (
  database: Database.Database,
  input: RevokeAdminUserSessionInput
) =>
  database.transaction(() => {
    if (input.currentSessionId === input.sessionId) {
      throw adminAuthError(
        'admin_current_session_revoke_forbidden',
        'Sign out to revoke the current session'
      );
    }
    const row = database
      .prepare(
        `SELECT id, userId, createdAt, updatedAt, expiresAt
         FROM "session"
         WHERE id = ? AND userId = ?`
      )
      .get(input.sessionId, input.userId) as SessionRow | undefined;
    if (!row) {
      throw adminAuthError('admin_session_not_found', 'Session does not exist for this user');
    }
    const removed = database
      .prepare('DELETE FROM "session" WHERE id = ? AND userId = ?')
      .run(input.sessionId, input.userId);
    if (removed.changes !== 1) {
      throw adminAuthError('admin_session_conflict', 'Session changed before this request');
    }
    writeAudit(
      database,
      input.audit,
      'auth.session.revoke',
      'session',
      input.sessionId,
      { userId: input.userId },
      { revoked: true }
    );
    return {
      sessionId: input.sessionId,
      userId: input.userId,
      revoked: true as const,
    };
  })();

import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import {
  adminAuthErrorCode,
  changeAdminUserRole,
  listAdminUsers,
  listAdminUserSessions,
  revokeAdminUserSession,
} from './admin-repository.js';

const now = new Date('2026-07-25T08:00:00.000Z');
const audit = { actorId: 'owner-1', requestId: 'request-private' };

const createFixture = async () => {
  const { database } = openDatabase(':memory:');
  await migrateDatabase(database, { directory: 'migrations', databasePath: ':memory:' });
  const insertUser = database.prepare(
    `INSERT INTO "user"
      (id, name, email, emailVerified, image, createdAt, updatedAt, role)
     VALUES (?, ?, ?, 1, NULL, ?, ?, ?)`
  );
  insertUser.run(
    'owner-1',
    'Owner',
    'owner@example.com',
    '2026-07-20T00:00:00.000Z',
    '2026-07-20T00:00:00.000Z',
    'owner'
  );
  insertUser.run(
    'viewer-1',
    'Viewer',
    'viewer@example.com',
    '2026-07-21T00:00:00.000Z',
    '2026-07-21T00:00:00.000Z',
    'viewer'
  );
  const insertSession = database.prepare(
    `INSERT INTO "session"
      (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertSession.run(
    'session-current',
    '2026-07-26T00:00:00.000Z',
    'current-secret-token',
    '2026-07-25T07:00:00.000Z',
    '2026-07-25T07:00:00.000Z',
    '203.0.113.1',
    'private-owner-agent',
    'owner-1'
  );
  insertSession.run(
    'session-viewer',
    '2026-07-26T00:00:00.000Z',
    'viewer-secret-token',
    '2026-07-25T06:00:00.000Z',
    '2026-07-25T06:00:00.000Z',
    '203.0.113.2',
    'private-viewer-agent',
    'viewer-1'
  );
  insertSession.run(
    'session-expired',
    '2026-07-24T00:00:00.000Z',
    'expired-secret-token',
    '2026-07-23T06:00:00.000Z',
    '2026-07-23T06:00:00.000Z',
    null,
    null,
    'viewer-1'
  );
  database
    .prepare(
      `INSERT INTO "passkey"
        (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp,
         transports, createdAt, aaguid)
       VALUES ('passkey-1', 'Laptop', 'private-public-key', 'viewer-1', 'credential-1',
         0, 'singleDevice', 0, NULL, ?, NULL)`
    )
    .run('2026-07-22T00:00:00.000Z');
  return database;
};

test('lists users and active sessions without authentication or request metadata', async () => {
  const database = await createFixture();
  try {
    const users = listAdminUsers(database, now);
    assert.deepEqual(
      users.map(user => ({
        id: user.id,
        activeSessionCount: user.activeSessionCount,
        passkeyCount: user.passkeyCount,
      })),
      [
        { id: 'owner-1', activeSessionCount: 1, passkeyCount: 0 },
        { id: 'viewer-1', activeSessionCount: 1, passkeyCount: 1 },
      ]
    );
    const sessions = listAdminUserSessions(database, 'owner-1', 'session-current', now);
    assert.deepEqual(sessions, [
      {
        id: 'session-current',
        userId: 'owner-1',
        createdAt: '2026-07-25T07:00:00.000Z',
        updatedAt: '2026-07-25T07:00:00.000Z',
        expiresAt: '2026-07-26T00:00:00.000Z',
        current: true,
      },
    ]);
    const serialized = JSON.stringify({ users, sessions });
    assert.doesNotMatch(
      serialized,
      /secret-token|203\.0\.113|private-owner-agent|private-viewer-agent|private-public-key/u
    );
  } finally {
    database.close();
  }
});

test('rejects self-demotion and demoting the final owner', async () => {
  const database = await createFixture();
  try {
    assert.throws(
      () =>
        changeAdminUserRole(database, {
          actorUserId: 'owner-1',
          userId: 'owner-1',
          expectedRole: 'owner',
          role: 'viewer',
          audit,
        }),
      error => adminAuthErrorCode(error) === 'admin_self_role_change_forbidden'
    );
    assert.throws(
      () =>
        changeAdminUserRole(database, {
          actorUserId: 'another-owner',
          userId: 'owner-1',
          expectedRole: 'owner',
          role: 'viewer',
          audit: { ...audit, actorId: 'another-owner' },
        }),
      error => adminAuthErrorCode(error) === 'admin_last_owner_forbidden'
    );
    assert.equal(
      (
        database.prepare(`SELECT role FROM "user" WHERE id = 'owner-1'`).get() as {
          role: string;
        }
      ).role,
      'owner'
    );
  } finally {
    database.close();
  }
});

test('changes a role, revokes target sessions and writes a low-sensitivity audit', async () => {
  const database = await createFixture();
  try {
    const result = changeAdminUserRole(database, {
      actorUserId: 'owner-1',
      userId: 'viewer-1',
      expectedRole: 'viewer',
      role: 'editor',
      audit,
    });
    assert.equal(result.user.role, 'editor');
    assert.equal(result.revokedSessions, 2);
    assert.equal(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM "session" WHERE userId = 'viewer-1'`)
          .get() as {
          count: number;
        }
      ).count,
      0
    );
    const row = database
      .prepare(
        `SELECT action, target_id, request_id, before_json, after_json
         FROM admin_audit
         WHERE action = 'auth.user.role.change'`
      )
      .get() as Record<string, string>;
    assert.equal(row.target_id, 'viewer-1');
    assert.deepEqual(JSON.parse(row.before_json), { role: 'viewer' });
    assert.deepEqual(JSON.parse(row.after_json), { role: 'editor', revokedSessions: 2 });
    assert.doesNotMatch(
      `${row.before_json}${row.after_json}`,
      /example\.com|secret-token|private-agent/u
    );
  } finally {
    database.close();
  }
});

test('revokes only a matching non-current session', async () => {
  const database = await createFixture();
  try {
    assert.throws(
      () =>
        revokeAdminUserSession(database, {
          currentSessionId: 'session-current',
          userId: 'owner-1',
          sessionId: 'session-current',
          audit,
        }),
      error => adminAuthErrorCode(error) === 'admin_current_session_revoke_forbidden'
    );
    assert.throws(
      () =>
        revokeAdminUserSession(database, {
          currentSessionId: 'session-current',
          userId: 'owner-1',
          sessionId: 'session-viewer',
          audit,
        }),
      error => adminAuthErrorCode(error) === 'admin_session_not_found'
    );
    const result = revokeAdminUserSession(database, {
      currentSessionId: 'session-current',
      userId: 'viewer-1',
      sessionId: 'session-viewer',
      audit,
    });
    assert.deepEqual(result, {
      sessionId: 'session-viewer',
      userId: 'viewer-1',
      revoked: true,
    });
    assert.equal(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM "session" WHERE id = 'session-viewer'`)
          .get() as {
          count: number;
        }
      ).count,
      0
    );
  } finally {
    database.close();
  }
});

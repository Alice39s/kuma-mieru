import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { adminAuditErrorCode, listAdminAudit } from './audit-repository.js';

const createFixture = async () => {
  const { database } = openDatabase(':memory:');
  await migrateDatabase(database, { directory: 'migrations', databasePath: ':memory:' });
  const insert = database.prepare(
    `INSERT INTO admin_audit
      (id, occurred_at, actor_id, action, target_type, target_id, request_id, ip_address,
       user_agent, result, before_json, after_json, error_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run(
    'audit-d',
    '2026-07-25T04:00:00.000Z',
    'owner-1',
    'backup.create',
    'backup',
    'bkp-1',
    'request-secret-d',
    '203.0.113.10',
    'private-user-agent',
    'success',
    '{"secret":"before"}',
    '{"secret":"after"}',
    null
  );
  insert.run(
    'audit-c',
    '2026-07-25T03:00:00.000Z',
    'owner-1',
    'retention.run',
    'retention',
    null,
    'request-secret-c',
    null,
    null,
    'failed',
    null,
    null,
    'RETENTION_IN_PROGRESS'
  );
  insert.run(
    'audit-b',
    '2026-07-25T03:00:00.000Z',
    'owner-2',
    'retention.run',
    'retention',
    null,
    'request-secret-b',
    null,
    null,
    'denied',
    null,
    null,
    'FORBIDDEN'
  );
  insert.run(
    'audit-a',
    '2026-07-25T02:00:00.000Z',
    'owner-2',
    'config.rollback',
    'revision',
    '2',
    'request-secret-a',
    null,
    null,
    'success',
    null,
    null,
    null
  );
  return database;
};

test('paginates admin audit with a stable timestamp and id cursor', async () => {
  const database = await createFixture();
  try {
    const first = listAdminAudit(database, { limit: 2 });
    assert.deepEqual(
      first.entries.map(entry => entry.id),
      ['audit-d', 'audit-c']
    );
    assert.ok(first.nextCursor);
    const second = listAdminAudit(database, { limit: 2, cursor: first.nextCursor });
    assert.deepEqual(
      second.entries.map(entry => entry.id),
      ['audit-b', 'audit-a']
    );
    assert.equal(second.nextCursor, null);
  } finally {
    database.close();
  }
});

test('filters audit rows without projecting request metadata or before and after payloads', async () => {
  const database = await createFixture();
  try {
    const page = listAdminAudit(database, {
      limit: 10,
      action: 'retention.run',
      result: 'failed',
    });
    assert.deepEqual(page.entries, [
      {
        id: 'audit-c',
        occurredAt: '2026-07-25T03:00:00.000Z',
        actorId: 'owner-1',
        action: 'retention.run',
        targetType: 'retention',
        targetId: null,
        result: 'failed',
        errorCode: 'RETENTION_IN_PROGRESS',
      },
    ]);
    const serialized = JSON.stringify(page);
    assert.doesNotMatch(serialized, /request-secret|203\.0\.113|user-agent|secret/u);
  } finally {
    database.close();
  }
});

test('rejects malformed admin audit cursors', async () => {
  const database = await createFixture();
  try {
    assert.throws(
      () => listAdminAudit(database, { limit: 10, cursor: 'not-a-valid-cursor' }),
      error => adminAuditErrorCode(error) === 'admin_audit_cursor_invalid'
    );
    const filtered = listAdminAudit(database, {
      limit: 1,
      result: 'success',
    });
    assert.ok(filtered.nextCursor);
    assert.throws(
      () =>
        listAdminAudit(database, {
          limit: 10,
          cursor: filtered.nextCursor ?? undefined,
          result: 'failed',
        }),
      error => adminAuditErrorCode(error) === 'admin_audit_cursor_filter_mismatch'
    );
  } finally {
    database.close();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import {
  deleteAdminPasskey,
  listAdminPasskeys,
  passkeyAdminErrorCode,
  recordAdminPasskeyRegistration,
  renameAdminPasskey,
} from './passkey-repository.js';

const audit = { actorId: 'owner-1', requestId: 'request-sensitive' };

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
    '2026-07-25T00:00:00.000Z',
    '2026-07-25T00:00:00.000Z',
    'owner'
  );
  insertUser.run(
    'viewer-1',
    'Viewer',
    'viewer@example.com',
    '2026-07-25T00:00:00.000Z',
    '2026-07-25T00:00:00.000Z',
    'viewer'
  );
  const insertPasskey = database.prepare(
    `INSERT INTO "passkey"
      (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp,
       transports, createdAt, aaguid)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
  );
  insertPasskey.run(
    'owner-passkey',
    'MacBook',
    'private-public-key',
    'owner-1',
    'private-credential-id',
    'multiDevice',
    1,
    'internal,hybrid',
    '2026-07-25T01:00:00.000Z',
    'private-aaguid'
  );
  insertPasskey.run(
    'viewer-passkey',
    null,
    'viewer-public-key',
    'viewer-1',
    'viewer-credential-id',
    'singleDevice',
    0,
    'usb',
    '2026-07-25T02:00:00.000Z',
    null
  );
  return database;
};

test('lists only the current user passkey metadata and excludes credential material', async () => {
  const database = await createFixture();
  try {
    const passkeys = listAdminPasskeys(database, 'owner-1');
    assert.deepEqual(passkeys, [
      {
        id: 'owner-passkey',
        name: 'MacBook',
        deviceType: 'multiDevice',
        backedUp: true,
        createdAt: '2026-07-25T01:00:00.000Z',
      },
    ]);
    assert.doesNotMatch(
      JSON.stringify(passkeys),
      /private-public-key|private-credential-id|private-aaguid|internal,hybrid/u
    );
  } finally {
    database.close();
  }
});

test('records registration only for a passkey owned by the authenticated user', async () => {
  const database = await createFixture();
  try {
    assert.throws(
      () => recordAdminPasskeyRegistration(database, 'owner-1', 'viewer-passkey', audit),
      error => passkeyAdminErrorCode(error) === 'passkey_not_found'
    );
    const registered = recordAdminPasskeyRegistration(database, 'owner-1', 'owner-passkey', audit);
    assert.equal(registered.id, 'owner-passkey');
    const row = database
      .prepare(
        `SELECT action, target_id, before_json, after_json
         FROM admin_audit WHERE action = 'auth.passkey.register'`
      )
      .get() as Record<string, string | null>;
    assert.equal(row.target_id, 'owner-passkey');
    assert.equal(row.before_json, null);
    assert.deepEqual(JSON.parse(row.after_json ?? '{}'), {
      deviceType: 'multiDevice',
      backedUp: true,
    });
    assert.doesNotMatch(row.after_json ?? '', /public-key|credential-id|aaguid|transport/u);
  } finally {
    database.close();
  }
});

test('renames with an expected name and rejects cross-user or stale writes', async () => {
  const database = await createFixture();
  try {
    assert.throws(
      () =>
        renameAdminPasskey(database, {
          userId: 'owner-1',
          passkeyId: 'viewer-passkey',
          expectedName: null,
          name: 'Not mine',
          audit,
        }),
      error => passkeyAdminErrorCode(error) === 'passkey_not_found'
    );
    assert.throws(
      () =>
        renameAdminPasskey(database, {
          userId: 'owner-1',
          passkeyId: 'owner-passkey',
          expectedName: 'Stale name',
          name: 'Office key',
          audit,
        }),
      error => passkeyAdminErrorCode(error) === 'passkey_name_conflict'
    );
    const updated = renameAdminPasskey(database, {
      userId: 'owner-1',
      passkeyId: 'owner-passkey',
      expectedName: 'MacBook',
      name: 'Office key',
      audit,
    });
    assert.equal(updated.name, 'Office key');
  } finally {
    database.close();
  }
});

test('deletes only an owned passkey bound to its expected name', async () => {
  const database = await createFixture();
  try {
    assert.throws(
      () =>
        deleteAdminPasskey(database, {
          userId: 'owner-1',
          passkeyId: 'owner-passkey',
          expectedName: 'Stale name',
          audit,
        }),
      error => passkeyAdminErrorCode(error) === 'passkey_name_conflict'
    );
    const result = deleteAdminPasskey(database, {
      userId: 'owner-1',
      passkeyId: 'owner-passkey',
      expectedName: 'MacBook',
      audit,
    });
    assert.deepEqual(result, { passkeyId: 'owner-passkey', deleted: true });
    assert.equal(listAdminPasskeys(database, 'owner-1').length, 0);
    assert.equal(listAdminPasskeys(database, 'viewer-1').length, 1);
  } finally {
    database.close();
  }
});

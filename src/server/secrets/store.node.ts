import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { loadOrCreateSecretKeyring, type SecretKeyring } from './keyring.js';
import { createSecretStore } from './store.js';

const binding = { resourceId: 'source-one', fieldName: 'apiToken', purpose: 'source-token' };

const withSecretDatabase = async (
  run: (database: ReturnType<typeof openDatabase>['database']) => void
) => {
  const { database } = openDatabase(':memory:');
  database.exec(
    await readFile(resolve(process.cwd(), 'migrations/000006_secret_store.up.sql'), 'utf8')
  );
  try {
    run(database);
  } finally {
    database.close();
  }
};

test('creates a rootless 0600 keyring and reloads the same current key', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-keyring-'));
  try {
    const first = await loadOrCreateSecretKeyring(directory, {});
    const second = await loadOrCreateSecretKeyring(directory, {});
    assert.equal(first.currentKeyId, second.currentKeyId);
    assert.deepEqual(first.keys.get(first.currentKeyId), second.keys.get(second.currentKeyId));
    const file = await stat(resolve(directory, '.secrets/keyring.json'));
    assert.equal(file.mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('encrypts bound secrets and never returns ciphertext from metadata', async () => {
  await withSecretDatabase(database => {
    const key = Buffer.alloc(32, 7);
    const store = createSecretStore(database, {
      currentKeyId: 'key-one',
      keys: new Map([['key-one', key]]),
    });
    const metadata = store.put(binding, 'top-secret-token');
    assert.equal(store.resolve(metadata.secretRef, binding), 'top-secret-token');
    assert.deepEqual(store.list(), [metadata]);
    assert.equal('ciphertext' in metadata, false);
    const row = database
      .prepare('SELECT ciphertext FROM encrypted_secrets WHERE secret_ref = ?')
      .get(metadata.secretRef) as { ciphertext: Buffer };
    assert.equal(row.ciphertext.includes(Buffer.from('top-secret-token')), false);
    assert.throws(
      () => store.resolve(metadata.secretRef, { ...binding, resourceId: 'other-source' }),
      /not valid for this consumer/u
    );
  });
});

test('reads an old key and atomically rotates records to the current key', async () => {
  await withSecretDatabase(database => {
    const oldKey = Buffer.alloc(32, 3);
    const newKey = Buffer.alloc(32, 9);
    const oldKeyring: SecretKeyring = {
      currentKeyId: 'key-old',
      keys: new Map([['key-old', oldKey]]),
    };
    const metadata = createSecretStore(database, oldKeyring).put(binding, 'rotating-token');
    const rotatingStore = createSecretStore(database, {
      currentKeyId: 'key-new',
      keys: new Map([
        ['key-old', oldKey],
        ['key-new', newKey],
      ]),
    });
    assert.equal(rotatingStore.resolve(metadata.secretRef, binding), 'rotating-token');
    assert.equal(rotatingStore.rotateAll(), 1);
    assert.equal(
      (
        database
          .prepare('SELECT key_id FROM encrypted_secrets WHERE secret_ref = ?')
          .get(metadata.secretRef) as { key_id: string }
      ).key_id,
      'key-new'
    );
    const currentOnly = createSecretStore(database, {
      currentKeyId: 'key-new',
      keys: new Map([['key-new', newKey]]),
    });
    assert.equal(currentOnly.resolve(metadata.secretRef, binding), 'rotating-token');
  });
});

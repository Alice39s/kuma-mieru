import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import type { CanonicalConfig } from '../config/schema.js';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { createSecretStore } from '../secrets/store.js';
import { createPiiProtector } from '../subscriptions/crypto.js';
import { createDeliveryRuntime } from './runtime.js';
import type { SmtpTransportConfig } from './smtp.js';

test('atomically replaces or disables a configured delivery worker', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-delivery-runtime-'));
  const databasePath = resolve(directory, 'delivery.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const secretStore = createSecretStore(database, {
      currentKeyId: 'delivery-runtime-key',
      keys: new Map([['delivery-runtime-key', Buffer.alloc(32, 29)]]),
    });
    const created: SmtpTransportConfig[] = [];
    let starts = 0;
    let stops = 0;
    const runtime = createDeliveryRuntime({
      database,
      protector: createPiiProtector('delivery-runtime-protector-secret'),
      secretStore,
      createTransport: config => {
        created.push(config);
        return {
          verify: async () => undefined,
          send: async message => ({ messageId: message.messageId }),
          close: () => undefined,
        };
      },
      startWorker: () => {
        starts += 1;
        return () => {
          stops += 1;
        };
      },
    });
    const config = {
      schemaVersion: 1 as const,
      server: { publicBaseUrl: 'https://status.example.com' },
      delivery: {
        smtp: {
          enabled: true as const,
          host: 'smtp.example.com',
          port: 587,
          tls: 'starttls' as const,
          from: { address: 'status@example.com' },
        },
      },
      sources: [],
      pages: [],
    } satisfies CanonicalConfig;

    assert.equal(runtime.apply(config).state, 'running');
    assert.equal(starts, 1);
    assert.equal(stops, 0);
    assert.deepEqual(created[0], {
      host: 'smtp.example.com',
      port: 587,
      tls: 'starttls',
      username: undefined,
      password: undefined,
      from: { address: 'status@example.com' },
      replyTo: undefined,
    });

    assert.equal(
      runtime.apply({
        ...config,
        delivery: {
          smtp: {
            ...config.delivery.smtp,
            host: 'smtp-backup.example.com',
          },
        },
      }).state,
      'running'
    );
    assert.equal(starts, 2);
    assert.equal(stops, 1);

    assert.equal(
      runtime.apply({ ...config, delivery: { smtp: { enabled: false } } }).state,
      'disabled'
    );
    assert.equal(stops, 2);
    runtime.stop();
    assert.equal(stops, 2);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed when an enabled configuration references an unavailable secret', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-delivery-runtime-failure-'));
  const databasePath = resolve(directory, 'delivery.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const secretStore = createSecretStore(database, {
      currentKeyId: 'delivery-runtime-failure-key',
      keys: new Map([['delivery-runtime-failure-key', Buffer.alloc(32, 31)]]),
    });
    let starts = 0;
    let stops = 0;
    const runtime = createDeliveryRuntime({
      database,
      protector: createPiiProtector('delivery-runtime-failure-secret'),
      secretStore,
      createTransport: () => ({
        verify: async () => undefined,
        send: async message => ({ messageId: message.messageId }),
        close: () => undefined,
      }),
      startWorker: () => {
        starts += 1;
        return () => {
          stops += 1;
        };
      },
    });
    assert.equal(
      runtime.apply({
        schemaVersion: 1,
        server: { publicBaseUrl: 'https://status.example.com' },
        delivery: {
          smtp: {
            enabled: true,
            host: 'smtp.example.com',
            port: 587,
            tls: 'starttls',
            from: { address: 'status@example.com' },
          },
        },
        sources: [],
        pages: [],
      }).state,
      'running'
    );
    const status = runtime.apply({
      schemaVersion: 1,
      server: { publicBaseUrl: 'https://status.example.com' },
      delivery: {
        smtp: {
          enabled: true,
          host: 'smtp.example.com',
          port: 587,
          tls: 'starttls',
          from: { address: 'status@example.com' },
          credentialSetId: 'smtp_missing',
          usernameRef: 'sec_missing_username',
          passwordRef: 'sec_missing_password',
        },
      },
      sources: [],
      pages: [],
    });
    assert.deepEqual(
      { state: status.state, configured: status.configured, error: status.lastErrorCode },
      { state: 'failed', configured: true, error: 'secret_not_found' }
    );
    assert.equal(starts, 1);
    assert.equal(stops, 1);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

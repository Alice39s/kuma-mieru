import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { createSecretStore } from '../secrets/store.js';
import type { SmtpTransportConfig } from './smtp.js';
import { createSmtpTestService } from './smtp-config.js';
import type { EmailDeliveryTransport } from './transport.js';

test('verifies SMTP with a staged credential set and binds the token to the full config', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-smtp-test-'));
  const databasePath = resolve(directory, 'smtp.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const secretStore = createSecretStore(database, {
      currentKeyId: 'smtp-test-key',
      keys: new Map([['smtp-test-key', Buffer.alloc(32, 19)]]),
    });
    const resourceId = 'delivery.smtp:smtp_fixture';
    const username = secretStore.put(
      { resourceId, fieldName: 'username', purpose: 'smtp-credential' },
      'mailer@example.com'
    );
    const password = secretStore.put(
      { resourceId, fieldName: 'password', purpose: 'smtp-credential' },
      'not-returned-by-the-api'
    );
    const transports: SmtpTransportConfig[] = [];
    const messages: Array<{ to: string; subject: string; text: string; messageId: string }> = [];
    let verified = 0;
    let closed = 0;
    const createTransport = (config: SmtpTransportConfig): EmailDeliveryTransport => {
      transports.push(config);
      return {
        verify: async () => {
          verified += 1;
        },
        send: async message => {
          messages.push(message);
          return { messageId: message.messageId };
        },
        close: () => {
          closed += 1;
        },
      };
    };
    const now = new Date('2026-07-25T12:00:00Z');
    const service = createSmtpTestService({
      secret: 'smtp-test-signing-secret-with-sufficient-entropy',
      secretStore,
      createTransport,
      now: () => now,
    });
    const config = {
      enabled: true as const,
      host: 'smtp.example.com',
      port: 587,
      tls: 'starttls' as const,
      from: { address: 'status@example.com', name: 'Example Status' },
      replyTo: 'support@example.com',
      credentialSetId: 'smtp_fixture',
      usernameRef: username.secretRef,
      passwordRef: password.secretRef,
    };
    const result = await service.test(config);

    assert.equal(verified, 1);
    assert.equal(closed, 1);
    assert.deepEqual(transports, [
      {
        host: 'smtp.example.com',
        port: 587,
        tls: 'starttls',
        username: 'mailer@example.com',
        password: 'not-returned-by-the-api',
        from: { address: 'status@example.com', name: 'Example Status' },
        replyTo: 'support@example.com',
      },
    ]);
    assert.equal(service.validate(config, result.token), true);
    assert.equal(
      service.validate({ ...config, from: { address: 'changed@example.com' } }, result.token),
      false
    );
    assert.equal(service.validate(config, `${result.token}tampered`), false);
    const sent = await service.sendTest(config, 'operator@example.com');
    assert.equal(closed, 2);
    assert.equal(messages[0]?.to, 'operator@example.com');
    assert.equal(messages[0]?.subject, 'Kuma Mieru SMTP delivery test');
    assert.equal(messages[0]?.text.includes('credential'), true);
    assert.match(sent.messageId, /^<smtp-test-.+@example\.com>$/u);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('closes a failed verification transport and rejects expired tokens', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-smtp-expiry-'));
  const databasePath = resolve(directory, 'smtp.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const secretStore = createSecretStore(database, {
      currentKeyId: 'smtp-expiry-key',
      keys: new Map([['smtp-expiry-key', Buffer.alloc(32, 23)]]),
    });
    let closed = 0;
    const service = createSmtpTestService({
      secret: 'smtp-test-signing-secret-with-sufficient-entropy',
      secretStore,
      lifetimeMs: -1,
      createTransport: () => ({
        verify: async () => undefined,
        send: async message => ({ messageId: message.messageId }),
        close: () => {
          closed += 1;
        },
      }),
    });
    const config = {
      enabled: true as const,
      host: 'smtp.example.com',
      port: 465,
      tls: 'implicit' as const,
      from: { address: 'status@example.com' },
    };
    const result = await service.test(config);
    assert.equal(closed, 1);
    assert.equal(service.validate(config, result.token), false);

    const failing = createSmtpTestService({
      secret: 'smtp-test-signing-secret-with-sufficient-entropy',
      secretStore,
      createTransport: () => ({
        verify: async () => {
          throw new Error('fixture verification failure');
        },
        send: async message => ({ messageId: message.messageId }),
        close: () => {
          closed += 1;
        },
      }),
    });
    await assert.rejects(failing.test(config), /fixture verification failure/u);
    assert.equal(closed, 2);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

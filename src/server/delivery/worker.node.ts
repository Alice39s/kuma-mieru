import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { createPiiProtector } from '../subscriptions/crypto.js';
import { requestEmailSubscription } from '../subscriptions/repository.js';
import type { EmailDeliveryTransport, EmailMessage } from './transport.js';
import { processDeliveryBatch } from './worker.js';

const setupPendingSubscription = (
  database: ReturnType<typeof openDatabase>['database'],
  email: string,
  protector: ReturnType<typeof createPiiProtector>
) =>
  requestEmailSubscription(database, protector, 'public', {
    email,
    componentIds: [],
    nonce: 'verified-at-the-route-boundary',
  });

test('sends queued confirmation mail with a stable Message-ID', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-delivery-'));
  const databasePath = resolve(directory, 'delivery.sqlite3');
  const { database } = openDatabase(databasePath);
  const protector = createPiiProtector('delivery-test-secret-with-enough-entropy');
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    setupPendingSubscription(database, 'recipient@example.com', protector);
    const messages: EmailMessage[] = [];
    const transport: EmailDeliveryTransport = {
      verify: async () => undefined,
      send: async message => {
        messages.push(message);
        return { messageId: message.messageId };
      },
      close: () => undefined,
    };
    const result = await processDeliveryBatch({
      database,
      protector,
      transport,
      publicBaseUrl: 'https://status.example.com',
      workerId: 'test-worker',
    });
    assert.deepEqual(result, { processed: 1, sent: 1, failed: 0 });
    assert.equal(messages[0]?.to, 'recipient@example.com');
    assert.equal(messages[0]?.text.includes('/subscriptions/confirm/'), true);
    assert.equal(messages[0]?.messageId.endsWith('@status.example.com>'), true);
    const outbox = database
      .prepare('SELECT id, state, attempts, sent_at FROM notification_outbox')
      .get() as { id: string; state: string; attempts: number; sent_at: string | null };
    assert.equal(outbox.state, 'sent');
    assert.equal(outbox.attempts, 1);
    assert.ok(outbox.sent_at);
    assert.equal(messages[0]?.messageId, `<${outbox.id}@status.example.com>`);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('retries transient SMTP failures and suppresses permanent recipient failures', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-delivery-failure-'));
  const databasePath = resolve(directory, 'delivery.sqlite3');
  const { database } = openDatabase(databasePath);
  const protector = createPiiProtector('delivery-failure-secret-with-enough-entropy');
  const now = new Date('2030-07-22T18:00:00.000Z');
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    setupPendingSubscription(database, 'transient@example.com', protector);
    const transientTransport: EmailDeliveryTransport = {
      verify: async () => undefined,
      send: async () => {
        throw Object.assign(new Error('Temporary mailbox failure'), {
          code: 'EENVELOPE',
          command: 'RCPT TO',
          responseCode: 451,
        });
      },
      close: () => undefined,
    };
    assert.deepEqual(
      await processDeliveryBatch({
        database,
        protector,
        transport: transientTransport,
        publicBaseUrl: 'https://status.example.com',
        now: () => now,
      }),
      { processed: 1, sent: 0, failed: 1 }
    );
    const transient = database
      .prepare('SELECT state, attempts, next_attempt_at FROM notification_outbox')
      .get() as { state: string; attempts: number; next_attempt_at: string };
    assert.equal(transient.state, 'failed');
    assert.equal(transient.attempts, 1);
    assert.equal(transient.next_attempt_at, '2030-07-22T18:01:00.000Z');

    database.prepare('DELETE FROM notification_outbox').run();
    database.prepare('DELETE FROM subscription_tokens').run();
    database.prepare('DELETE FROM email_subscriptions').run();
    setupPendingSubscription(database, 'permanent@example.com', protector);
    const permanentTransport: EmailDeliveryTransport = {
      verify: async () => undefined,
      send: async () => {
        throw Object.assign(new Error('Mailbox does not exist'), {
          code: 'EENVELOPE',
          command: 'RCPT TO',
          responseCode: 550,
        });
      },
      close: () => undefined,
    };
    await processDeliveryBatch({
      database,
      protector,
      transport: permanentTransport,
      publicBaseUrl: 'https://status.example.com',
      now: () => now,
    });
    const permanent = database
      .prepare('SELECT state, last_error_code FROM notification_outbox')
      .get() as { state: string; last_error_code: string };
    assert.deepEqual(permanent, { state: 'dead_letter', last_error_code: 'EENVELOPE' });
    assert.equal(
      (database.prepare('SELECT state FROM email_subscriptions').get() as { state: string }).state,
      'pending_confirmation'
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

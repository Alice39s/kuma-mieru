import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { createPiiProtector } from './crypto.js';
import {
  confirmEmailSubscription,
  inspectSubscriptionToken,
  requestEmailSubscription,
  unsubscribeEmail,
  updateEmailSubscription,
} from './repository.js';

test('encrypts subscriber PII and requires POST confirmation before activation', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-subscriptions-'));
  const databasePath = resolve(directory, 'subscriptions.sqlite3');
  const { database } = openDatabase(databasePath);
  const protector = createPiiProtector('subscriber-test-secret-with-enough-entropy');
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    requestEmailSubscription(database, protector, 'public', {
      email: 'Operator@Example.com ',
      componentIds: ['api'],
      nonce: 'verified-at-the-route-boundary',
    });
    const subscriber = database
      .prepare(
        `SELECT id, email_hash, email_ciphertext, state
         FROM email_subscriptions WHERE page_id = 'public'`
      )
      .get() as {
      id: string;
      email_hash: string;
      email_ciphertext: string;
      state: string;
    };
    assert.equal(subscriber.state, 'pending_confirmation');
    assert.notEqual(subscriber.email_ciphertext.includes('Operator@Example.com'), true);
    assert.equal(protector.decrypt(subscriber.email_ciphertext), 'operator@example.com');
    assert.equal(subscriber.email_hash, protector.emailHash('operator@example.com'));

    const outbox = database
      .prepare(
        `SELECT payload_ciphertext FROM notification_outbox
         WHERE subscription_id = ? AND kind = 'subscription_confirmation'`
      )
      .get(subscriber.id) as { payload_ciphertext: string };
    const payload = JSON.parse(protector.decrypt(outbox.payload_ciphertext)) as {
      confirmToken: string;
      manageToken: string;
      unsubscribeToken: string;
    };
    const preview = inspectSubscriptionToken(database, protector, payload.confirmToken, 'confirm');
    assert.equal(preview?.state, 'pending_confirmation');
    assert.equal(
      (
        database
          .prepare('SELECT consumed_at FROM subscription_tokens WHERE token_hash = ?')
          .get(protector.tokenHash(payload.confirmToken)) as { consumed_at: string | null }
      ).consumed_at,
      null
    );

    const confirmed = confirmEmailSubscription(database, protector, payload.confirmToken);
    assert.equal(confirmed.state, 'active');
    assert.throws(() => confirmEmailSubscription(database, protector, payload.confirmToken));
    assert.equal(
      inspectSubscriptionToken(database, protector, payload.manageToken, 'manage')?.state,
      'active'
    );
    const updated = updateEmailSubscription(database, protector, payload.manageToken, {
      componentIds: ['worker', 'api', 'worker'],
    });
    assert.deepEqual(updated.componentIds, ['api', 'worker']);
    assert.equal(
      unsubscribeEmail(database, protector, payload.unsubscribeToken).unsubscribed,
      true
    );
    assert.equal(
      inspectSubscriptionToken(database, protector, payload.manageToken, 'manage')?.state,
      'unsubscribed'
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('returns the same acceptance shape when anonymous rate limits are exceeded', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-subscription-rate-'));
  const databasePath = resolve(directory, 'subscriptions.sqlite3');
  const { database } = openDatabase(databasePath);
  const protector = createPiiProtector('subscriber-rate-secret-with-enough-entropy');
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    for (let index = 0; index < 7; index += 1) {
      assert.deepEqual(
        requestEmailSubscription(database, protector, 'public', {
          email: 'rate@example.com',
          componentIds: [],
          nonce: 'verified-at-the-route-boundary',
        }),
        { accepted: true }
      );
    }
    const outboxCount = (
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM notification_outbox
           WHERE kind = 'subscription_confirmation'`
        )
        .get() as { count: number }
    ).count;
    assert.equal(outboxCount, 5);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

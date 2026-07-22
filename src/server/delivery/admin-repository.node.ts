import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import {
  listAdminDeliveries,
  listAdminSubscribers,
  retryAdminDelivery,
  suppressAdminSubscriber,
} from './admin-repository.js';

const audit = { actorId: 'owner-1', requestId: 'delivery-admin-request-1' };

test('keeps subscriber PII private while retrying and suppressing delivery safely', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-delivery-admin-'));
  const databasePath = resolve(directory, 'delivery-admin.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO email_subscriptions
          (id, page_id, incident_id, scope_key, component_ids_json, email_hash,
           email_ciphertext, state, created_at, confirmed_at, updated_at)
         VALUES ('subscriber-1', 'public', NULL, 'page:*', '[]', ?, ?, 'active', ?, ?, ?)`
      )
      .run('a'.repeat(64), 'encrypted-address-value', now, now, now);
    database
      .prepare(
        `INSERT INTO notification_outbox
          (id, publication_id, subscription_id, channel, kind, idempotency_key, state,
           attempts, next_attempt_at, payload_ciphertext, last_error_code, created_at)
         VALUES ('delivery-1', NULL, 'subscriber-1', 'email', 'event_publication',
                 'delivery-admin-1', 'dead_letter', 8, ?, 'encrypted-payload',
                 'SMTP_550', ?)`
      )
      .run(now, now);

    const subscribers = listAdminSubscribers(database);
    const deliveries = listAdminDeliveries(database);
    assert.equal(subscribers[0]?.recipient, 'private-aaaaaaaaaa');
    assert.equal(JSON.stringify(subscribers).includes('encrypted-address-value'), false);
    assert.equal(JSON.stringify(deliveries).includes('encrypted-payload'), false);

    const queued = retryAdminDelivery(database, 'delivery-1', 'dead_letter', audit);
    assert.equal(queued.state, 'queued');
    assert.equal(queued.attempts, 0);
    assert.equal(queued.lastErrorCode, null);
    assert.throws(
      () => retryAdminDelivery(database, 'delivery-1', 'dead_letter', audit),
      error => {
        assert.equal((error as { code: string }).code, 'delivery_state_conflict');
        return true;
      }
    );

    const suppressed = suppressAdminSubscriber(database, 'subscriber-1', 'active', audit);
    assert.equal(suppressed.state, 'suppressed');
    assert.equal(listAdminDeliveries(database)[0]?.state, 'dead_letter');
    assert.equal(listAdminDeliveries(database)[0]?.lastErrorCode, 'ADMIN_SUPPRESSED');
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM admin_audit
             WHERE action IN ('delivery.retry', 'subscriber.suppress')`
          )
          .get() as { count: number }
      ).count,
      2
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { createPiiProtector } from '../subscriptions/crypto.js';
import {
  appendIncidentUpdate,
  createIncident,
  getPublicationReview,
  listPublishedIncidents,
  publishIncident,
} from './repository.js';

const audit = {
  actorId: 'owner-1',
  requestId: 'request-1',
  userAgent: 'event-test',
};

test('keeps incident updates append-only and publishes outbox work atomically', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-events-'));
  const databasePath = resolve(directory, 'events.sqlite3');
  const { database } = openDatabase(databasePath);
  const piiProtector = createPiiProtector('event-publication-test-secret-with-enough-entropy');
  try {
    const migration = await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    assert.equal(
      (
        database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
          version: number;
        }
      ).version,
      migration.currentVersion
    );

    const input = {
      pageId: 'public',
      title: 'API latency elevated',
      body: 'We are investigating elevated latency.',
      state: 'investigating' as const,
      affectedComponentIds: ['api'],
      occurredAt: '2026-07-22T18:00:00.000Z',
    };
    const created = createIncident(database, input, 'incident-create-0001', audit);
    const replayed = createIncident(database, input, 'incident-create-0001', audit);
    assert.equal(replayed.id, created.id);
    assert.equal(replayed.version, 1);
    assert.throws(
      () =>
        createIncident(
          database,
          { ...input, body: 'A different command payload.' },
          'incident-create-0001',
          audit
        ),
      error => {
        assert.equal((error as { code: string }).code, 'idempotency_key_reused');
        return true;
      }
    );

    const updated = appendIncidentUpdate(
      database,
      created.id,
      {
        expectedVersion: 1,
        state: 'identified',
        body: 'A dependency is saturating connections.',
        affectedComponentIds: ['api'],
        occurredAt: '2026-07-22T18:05:00.000Z',
      },
      audit
    );
    assert.equal(updated.version, 2);
    assert.equal(updated.latestEntry.sequence, 2);
    assert.throws(
      () =>
        appendIncidentUpdate(
          database,
          created.id,
          { expectedVersion: 1, state: 'monitoring', body: 'Stale writer.' },
          audit
        ),
      error => {
        assert.equal((error as { code: string }).code, 'event_version_conflict');
        return true;
      }
    );
    assert.throws(
      () =>
        appendIncidentUpdate(
          database,
          created.id,
          { expectedVersion: 2, state: 'investigating', body: 'Invalid backwards transition.' },
          audit
        ),
      error => {
        assert.equal((error as { code: string }).code, 'invalid_event_transition');
        return true;
      }
    );

    const insertSubscription = database.prepare(
      `INSERT INTO email_subscriptions
        (id, page_id, incident_id, scope_key, component_ids_json, email_hash,
         email_ciphertext, state, created_at, confirmed_at, updated_at)
       VALUES (?, 'public', NULL, ?, '[]', ?, ?, 'active', ?, ?, ?)`
    );
    insertSubscription.run(
      'subscription-1',
      'page:*',
      'hash-1',
      'ciphertext-1',
      '2026-07-22T18:00:00.000Z',
      '2026-07-22T18:00:00.000Z',
      '2026-07-22T18:00:00.000Z'
    );
    const review = getPublicationReview(database, created.id, 2);
    assert.equal(review.estimatedRecipients, 1);

    insertSubscription.run(
      'subscription-2',
      'page:*',
      'hash-2',
      'ciphertext-2',
      '2026-07-22T18:01:00.000Z',
      '2026-07-22T18:01:00.000Z',
      '2026-07-22T18:01:00.000Z'
    );
    assert.throws(
      () =>
        publishIncident(
          database,
          {
            eventId: created.id,
            expectedVersion: 2,
            notifySubscribers: true,
            expectedRecipients: review.estimatedRecipients,
            piiProtector,
          },
          audit
        ),
      error => {
        assert.equal((error as { code: string }).code, 'publication_review_stale');
        return true;
      }
    );
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM event_publications').get() as {
          count: number;
        }
      ).count,
      0
    );
    database.prepare("DELETE FROM email_subscriptions WHERE id = 'subscription-2'").run();

    const publication = publishIncident(
      database,
      {
        eventId: created.id,
        expectedVersion: 2,
        notifySubscribers: true,
        expectedRecipients: 1,
        piiProtector,
      },
      audit
    );
    assert.equal(publication.eventSequence, 2);
    assert.equal(listPublishedIncidents(database, 'public').length, 1);
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get() as {
          count: number;
        }
      ).count,
      1
    );
    assert.throws(
      () =>
        publishIncident(
          database,
          {
            eventId: created.id,
            expectedVersion: 2,
            notifySubscribers: true,
            expectedRecipients: 1,
            piiProtector,
          },
          audit
        ),
      error => {
        assert.equal((error as { code: string }).code, 'event_sequence_already_published');
        return true;
      }
    );
    assert.equal(
      (
        database
          .prepare('SELECT COUNT(*) AS count FROM native_event_entries WHERE event_id = ?')
          .get(created.id) as { count: number }
      ).count,
      2
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

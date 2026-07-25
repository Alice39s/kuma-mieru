import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { createPiiProtector } from '../subscriptions/crypto.js';
import {
  appendMaintenanceUpdate,
  createMaintenance,
  getMaintenance,
  getMaintenancePublicationReview,
  getPublishedMaintenance,
  publishMaintenance,
} from './maintenance-repository.js';
import {
  appendNoticeUpdate,
  createNotice,
  getNotice,
  getNoticePublicationReview,
  listPublishedNotices,
  publishNotice,
} from './notice-repository.js';
import {
  backfillEventLifecycleDueTimes,
  createEventLifecycleService,
  eventLifecycleErrorCode,
} from './lifecycle.js';

const migrationDirectory = resolve(process.cwd(), 'migrations');
const audit = { actorId: 'owner-1', requestId: 'event-lifecycle-fixture' };

test('backfills legacy lifecycle boundaries in bounded idempotent batches', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-event-lifecycle-backfill-'));
  const databasePath = resolve(directory, 'event-lifecycle-backfill.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, { directory: migrationDirectory, databasePath });
    const insertEvent = database.prepare(
      `INSERT INTO native_events
        (id, type, page_id, title, state, version, created_by, idempotency_key, request_hash,
         created_at, updated_at, details_json)
       VALUES (?, ?, 'public', ?, ?, 1, 'legacy-owner', ?, ?, ?, ?, ?)`
    );
    const occurredAt = '2026-07-24T00:00:00.000Z';
    const events = [
      {
        id: 'legacy-maintenance-scheduled',
        type: 'maintenance',
        state: 'scheduled',
        details: {
          scheduledStartAt: '2026-07-24T01:00:00+00:00',
          scheduledEndAt: '2026-07-24T02:00:00+00:00',
        },
      },
      {
        id: 'legacy-maintenance-progress',
        type: 'maintenance',
        state: 'in_progress',
        details: {
          scheduledStartAt: '2026-07-24T01:00:00+00:00',
          scheduledEndAt: '2026-07-24T02:00:00+00:00',
        },
      },
      {
        id: 'legacy-notice-published',
        type: 'notice',
        state: 'published',
        details: { endsAt: '2026-07-24T03:00:00+00:00' },
      },
      {
        id: 'legacy-maintenance-draft',
        type: 'maintenance',
        state: 'draft',
        details: {
          scheduledStartAt: '2026-07-24T01:00:00+00:00',
          scheduledEndAt: '2026-07-24T02:00:00+00:00',
        },
      },
      {
        id: 'legacy-incident',
        type: 'incident',
        state: 'investigating',
        details: {},
      },
    ] as const;
    database.transaction(() => {
      for (const event of events) {
        insertEvent.run(
          event.id,
          event.type,
          event.id,
          event.state,
          event.id,
          event.id,
          occurredAt,
          occurredAt,
          JSON.stringify(event.details)
        );
      }
    })();

    const first = backfillEventLifecycleDueTimes({ database, batchSize: 2 });
    assert.equal(first.batchSize, 2);
    assert.equal(first.batches, 2);
    assert.equal(first.updatedEvents, 3);
    assert.equal(first.maxWriteLockMilliseconds >= 0, true);
    assert.equal(first.totalWriteLockMilliseconds >= first.maxWriteLockMilliseconds, true);
    assert.deepEqual(
      database
        .prepare(
          `SELECT id, lifecycle_due_at
           FROM native_events
           WHERE id LIKE 'legacy-%'
           ORDER BY id`
        )
        .all(),
      [
        { id: 'legacy-incident', lifecycle_due_at: null },
        { id: 'legacy-maintenance-draft', lifecycle_due_at: null },
        {
          id: 'legacy-maintenance-progress',
          lifecycle_due_at: '2026-07-24T02:00:00.000Z',
        },
        {
          id: 'legacy-maintenance-scheduled',
          lifecycle_due_at: '2026-07-24T01:00:00.000Z',
        },
        { id: 'legacy-notice-published', lifecycle_due_at: '2026-07-24T03:00:00.000Z' },
      ]
    );
    assert.deepEqual(backfillEventLifecycleDueTimes({ database, batchSize: 2 }), {
      batchSize: 2,
      batches: 0,
      updatedEvents: 0,
      maxWriteLockMilliseconds: 0,
      totalWriteLockMilliseconds: 0,
    });
    assert.throws(
      () => backfillEventLifecycleDueTimes({ database, batchSize: 0 }),
      error => eventLifecycleErrorCode(error) === 'event_lifecycle_backfill_batch_invalid'
    );
    assert.throws(
      () => backfillEventLifecycleDueTimes({ database, batchSize: 251 }),
      error => eventLifecycleErrorCode(error) === 'event_lifecycle_backfill_batch_invalid'
    );

    insertEvent.run(
      'legacy-invalid-json',
      'maintenance',
      'Invalid legacy JSON',
      'scheduled',
      'legacy-invalid-json',
      'legacy-invalid-json',
      occurredAt,
      occurredAt,
      '{broken'
    );
    assert.throws(
      () => backfillEventLifecycleDueTimes({ database }),
      error => eventLifecycleErrorCode(error) === 'event_lifecycle_backfill_invalid'
    );
    database.prepare("DELETE FROM native_events WHERE id = 'legacy-invalid-json'").run();

    insertEvent.run(
      'legacy-invalid-maintenance',
      'maintenance',
      'Invalid legacy maintenance',
      'scheduled',
      'legacy-invalid-maintenance',
      'legacy-invalid-maintenance',
      occurredAt,
      occurredAt,
      '{}'
    );
    assert.throws(
      () => backfillEventLifecycleDueTimes({ database }),
      error => eventLifecycleErrorCode(error) === 'event_lifecycle_backfill_invalid'
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('catches up maintenance start and end atomically without inheriting email delivery', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-event-lifecycle-'));
  const databasePath = resolve(directory, 'event-lifecycle.sqlite3');
  const { database } = openDatabase(databasePath);
  const protector = createPiiProtector('event-lifecycle-test-secret');
  try {
    await migrateDatabase(database, { directory: migrationDirectory, databasePath });
    database
      .prepare(
        `INSERT INTO email_subscriptions
          (id, page_id, incident_id, scope_key, component_ids_json, email_hash,
           email_ciphertext, state, created_at, confirmed_at, updated_at)
         VALUES ('subscriber-1', 'public', NULL, 'page', '[]', 'email-hash',
                 'encrypted-address', 'active', ?, ?, ?)`
      )
      .run('2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z');
    const created = createMaintenance(
      database,
      {
        pageId: 'public',
        title: 'Database maintenance',
        body: 'A reviewed maintenance window.',
        state: 'draft',
        affectedComponentIds: ['database'],
        scheduledStartAt: '2026-07-24T01:00:00+00:00',
        scheduledEndAt: '2026-07-24T02:00:00+00:00',
      },
      'maintenance-lifecycle-create',
      audit
    );
    const scheduled = appendMaintenanceUpdate(
      database,
      created.id,
      {
        expectedVersion: created.version,
        state: 'scheduled',
        body: 'The maintenance window is confirmed.',
      },
      audit
    );
    assert.equal(
      (
        database
          .prepare('SELECT lifecycle_due_at FROM native_events WHERE id = ?')
          .get(created.id) as { lifecycle_due_at: string }
      ).lifecycle_due_at,
      '2026-07-24T01:00:00.000Z'
    );
    const review = getMaintenancePublicationReview(database, scheduled.id, scheduled.version);
    publishMaintenance(
      database,
      {
        eventId: scheduled.id,
        expectedVersion: scheduled.version,
        notifySubscribers: true,
        expectedRecipients: review.estimatedRecipients,
        piiProtector: protector,
      },
      audit
    );
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get() as {
          count: number;
        }
      ).count,
      1
    );

    const service = createEventLifecycleService({
      database,
      now: () => new Date('2026-07-24T03:00:00.000Z'),
    });
    assert.deepEqual(service.run(), {
      evaluatedAt: '2026-07-24T03:00:00.000Z',
      dueEvents: 1,
      transitionedEvents: 1,
      transitions: 2,
      publications: 2,
      hasMore: false,
      failures: [],
    });
    const completed = getMaintenance(database, created.id);
    assert.equal(completed?.state, 'completed');
    assert.equal(completed?.version, 4);
    assert.equal(
      (
        database
          .prepare('SELECT lifecycle_due_at FROM native_events WHERE id = ?')
          .get(created.id) as { lifecycle_due_at: string | null }
      ).lifecycle_due_at,
      null
    );
    const publications = getPublishedMaintenance(database, 'public', created.id);
    assert.deepEqual(
      publications.map(publication => [publication.eventSequence, publication.state]),
      [
        [2, 'scheduled'],
        [3, 'in_progress'],
        [4, 'completed'],
      ]
    );
    assert.equal(publications[1]?.occurredAt, '2026-07-24T01:00:00+00:00');
    assert.equal(publications[2]?.occurredAt, '2026-07-24T02:00:00+00:00');
    assert.deepEqual(
      database
        .prepare(
          `SELECT event_sequence, notify_subscribers, actor_id
           FROM event_publications WHERE event_id = ? ORDER BY event_sequence`
        )
        .all(created.id),
      [
        { event_sequence: 2, notify_subscribers: 1, actor_id: 'owner-1' },
        {
          event_sequence: 3,
          notify_subscribers: 0,
          actor_id: 'system:event-lifecycle',
        },
        {
          event_sequence: 4,
          notify_subscribers: 0,
          actor_id: 'system:event-lifecycle',
        },
      ]
    );
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get() as {
          count: number;
        }
      ).count,
      1
    );
    assert.equal(service.run().transitions, 0);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('expires only the currently reviewed notice version and remains idempotent after restart', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-notice-lifecycle-'));
  const databasePath = resolve(directory, 'notice-lifecycle.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, { directory: migrationDirectory, databasePath });
    const created = createNotice(
      database,
      {
        pageId: 'public',
        title: 'Temporary notice',
        body: 'This notice has a bounded display window.',
        state: 'draft',
        kind: 'information',
        affectedComponentIds: [],
        startsAt: '2026-07-24T00:00:00.000Z',
        endsAt: '2026-07-24T01:00:00.000Z',
      },
      'notice-lifecycle-create',
      audit
    );
    const ready = appendNoticeUpdate(
      database,
      created.id,
      {
        expectedVersion: created.version,
        state: 'published',
        body: 'This notice has a bounded display window.',
      },
      audit
    );
    const service = createEventLifecycleService({
      database,
      now: () => new Date('2026-07-24T02:00:00.000Z'),
    });
    assert.equal(service.run().dueEvents, 0);
    assert.equal(getNotice(database, ready.id)?.state, 'published');

    const review = getNoticePublicationReview(database, ready.id, ready.version);
    publishNotice(
      database,
      {
        eventId: ready.id,
        expectedVersion: ready.version,
        notifySubscribers: false,
        expectedRecipients: review.estimatedRecipients,
      },
      audit
    );
    const result = service.run();
    assert.equal(result.transitions, 1);
    assert.deepEqual(result.failures, []);
    assert.equal(getNotice(database, ready.id)?.state, 'expired');
    assert.deepEqual(
      listPublishedNotices(database, 'public')
        .sort((left, right) => left.eventSequence - right.eventSequence)
        .map(publication => publication.state),
      ['published', 'expired']
    );
    assert.deepEqual(
      database
        .prepare(
          `SELECT notify_subscribers, actor_id
           FROM event_publications WHERE event_id = ? ORDER BY event_sequence`
        )
        .all(ready.id),
      [
        { notify_subscribers: 0, actor_id: 'owner-1' },
        { notify_subscribers: 0, actor_id: 'system:event-lifecycle' },
      ]
    );
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get() as {
          count: number;
        }
      ).count,
      0
    );
    const restarted = createEventLifecycleService({
      database,
      now: () => new Date('2026-07-24T03:00:00.000Z'),
    });
    assert.equal(restarted.run().transitions, 0);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('pauses an automatic transition while the latest maintenance edit is unreviewed', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-lifecycle-review-gate-'));
  const databasePath = resolve(directory, 'review-gate.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, { directory: migrationDirectory, databasePath });
    const created = createMaintenance(
      database,
      {
        pageId: 'public',
        title: 'Reviewed schedule',
        body: 'Initial draft.',
        state: 'draft',
        affectedComponentIds: [],
        scheduledStartAt: '2026-07-24T01:00:00.000Z',
        scheduledEndAt: '2026-07-24T02:00:00.000Z',
      },
      'maintenance-review-gate-create',
      audit
    );
    const scheduled = appendMaintenanceUpdate(
      database,
      created.id,
      {
        expectedVersion: created.version,
        state: 'scheduled',
        body: 'Reviewed schedule.',
      },
      audit
    );
    const review = getMaintenancePublicationReview(database, scheduled.id, scheduled.version);
    publishMaintenance(
      database,
      {
        eventId: scheduled.id,
        expectedVersion: scheduled.version,
        notifySubscribers: false,
        expectedRecipients: review.estimatedRecipients,
      },
      audit
    );
    const privateEdit = appendMaintenanceUpdate(
      database,
      scheduled.id,
      {
        expectedVersion: scheduled.version,
        state: 'scheduled',
        body: 'Private reschedule awaiting review.',
        scheduledStartAt: '2026-07-24T01:30:00.000Z',
        scheduledEndAt: '2026-07-24T02:30:00.000Z',
      },
      audit
    );
    const service = createEventLifecycleService({
      database,
      now: () => new Date('2026-07-24T03:00:00.000Z'),
    });
    assert.equal(service.run().dueEvents, 0);
    assert.equal(getMaintenance(database, privateEdit.id)?.version, 3);
    assert.equal(getMaintenance(database, privateEdit.id)?.state, 'scheduled');
    assert.equal(getPublishedMaintenance(database, 'public', privateEdit.id).length, 1);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

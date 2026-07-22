import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import {
  appendMaintenanceUpdate,
  createMaintenance,
  getMaintenancePublicationReview,
  publishMaintenance,
} from './maintenance-repository.js';
import { listPublishedEvents, listPublishedIncidents } from './repository.js';

const audit = { actorId: 'owner-1', requestId: 'maintenance-request-1' };

test('keeps maintenance schedule updates append-only and publishes through the shared outbox core', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-maintenance-'));
  const databasePath = resolve(directory, 'maintenance.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const created = createMaintenance(
      database,
      {
        pageId: 'public',
        title: 'Database maintenance',
        body: 'We will apply a database upgrade.',
        state: 'draft',
        affectedComponentIds: ['database'],
        scheduledStartAt: '2026-07-24T01:00:00.000Z',
        scheduledEndAt: '2026-07-24T02:00:00.000Z',
      },
      'maintenance-create-0001',
      audit
    );
    assert.equal(created.state, 'draft');
    assert.throws(
      () => getMaintenancePublicationReview(database, created.id, created.version),
      error => {
        assert.equal((error as { code: string }).code, 'event_not_publishable');
        return true;
      }
    );
    const scheduled = appendMaintenanceUpdate(
      database,
      created.id,
      {
        expectedVersion: 1,
        state: 'scheduled',
        body: 'The maintenance window is confirmed.',
      },
      audit
    );
    assert.equal(scheduled.version, 2);
    assert.equal(scheduled.scheduledEndAt, '2026-07-24T02:00:00.000Z');
    assert.throws(
      () =>
        appendMaintenanceUpdate(
          database,
          created.id,
          { expectedVersion: 2, state: 'draft', body: 'Invalid backwards transition.' },
          audit
        ),
      error => {
        assert.equal((error as { code: string }).code, 'invalid_event_transition');
        return true;
      }
    );

    const review = getMaintenancePublicationReview(database, created.id, 2);
    const publication = publishMaintenance(
      database,
      {
        eventId: created.id,
        expectedVersion: 2,
        notifySubscribers: false,
        expectedRecipients: review.estimatedRecipients,
      },
      audit
    );
    assert.equal(publication.type, 'maintenance');
    assert.equal(publication.scheduledStartAt, '2026-07-24T01:00:00.000Z');
    assert.equal(listPublishedEvents(database, 'public').length, 1);
    assert.equal(listPublishedIncidents(database, 'public').length, 0);
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get() as {
          count: number;
        }
      ).count,
      0
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import {
  appendNoticeUpdate,
  createNotice,
  getNoticePublicationReview,
  listPublishedNotices,
  publishNotice,
} from './notice-repository.js';

const audit = { actorId: 'owner-1', requestId: 'notice-request-1' };

test('publishes a notice without changing incident or component status semantics', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-notice-'));
  const databasePath = resolve(directory, 'notice.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const created = createNotice(
      database,
      {
        pageId: 'public',
        title: 'Support hours update',
        body: 'Support hours will change next week.',
        state: 'draft',
        kind: 'information',
        affectedComponentIds: [],
        startsAt: '2026-07-25T00:00:00.000Z',
        endsAt: null,
      },
      'notice-create-0001',
      audit
    );
    assert.throws(
      () => getNoticePublicationReview(database, created.id, created.version),
      error => {
        assert.equal((error as { code: string }).code, 'event_not_publishable');
        return true;
      }
    );
    const ready = appendNoticeUpdate(
      database,
      created.id,
      {
        expectedVersion: 1,
        state: 'published',
        body: 'Support hours will change next week.',
      },
      audit
    );
    const review = getNoticePublicationReview(database, ready.id, ready.version);
    const publication = publishNotice(
      database,
      {
        eventId: ready.id,
        expectedVersion: ready.version,
        notifySubscribers: false,
        expectedRecipients: review.estimatedRecipients,
      },
      audit
    );
    assert.equal(publication.type, 'notice');
    assert.equal(publication.kind, 'information');
    assert.equal(listPublishedNotices(database, 'public').length, 1);
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM native_events WHERE type = 'incident'")
          .get() as {
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

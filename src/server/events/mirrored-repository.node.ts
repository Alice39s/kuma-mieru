import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import type { NormalizedSnapshot } from '../adapters/types.js';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import {
  getMirroredEventTimeline,
  listMirroredEvents,
  reconcileMirroredEvents,
} from './mirrored-repository.js';

const event = (content = 'Investigating an upstream failure') => ({
  id: 'provider:incident:incident-42',
  sourceEventId: 'incident-42',
  kind: 'incident' as const,
  title: 'Provider API unavailable',
  content,
  severity: 'danger' as const,
  startedAt: '2026-07-25T01:00:00.000Z',
  updatedAt: '2026-07-25T01:05:00.000Z',
  rawStatus: 'investigating',
});

const snapshot = (
  fetchedAt: string,
  incidents: NormalizedSnapshot['incidents']
): NormalizedSnapshot => ({
  sourceId: 'provider',
  pageId: 'public',
  title: 'Provider Status',
  description: '',
  status: 'major_outage',
  fetchedAt,
  sourceUpdatedAt: fetchedAt,
  extensions: {},
  capabilities: {
    currentStatus: true,
    heartbeatSeries: false,
    latencySeries: false,
    uptimeWindows: [],
    incidents: 'current',
    maintenance: true,
    groups: false,
    tags: false,
    nativeMetrics: false,
    historicalDays: null,
  },
  groups: [],
  services: [],
  incidents,
});

test('keeps mirrored source events append-only across update, absence and reappearance', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-mirrored-events-'));
  const databasePath = resolve(directory, 'mirrored.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const sourceUrl = 'https://reader:secret@status.example.com/public?token=hidden#private';
    assert.deepEqual(
      reconcileMirroredEvents(database, snapshot('2026-07-25T01:10:00.000Z', [event()]), {
        sourceUrl,
      }),
      { created: 1, updated: 0, absent: 0, reappeared: 0, unchanged: 0 }
    );
    assert.deepEqual(
      reconcileMirroredEvents(database, snapshot('2026-07-25T01:11:00.000Z', [event()]), {
        sourceUrl,
      }),
      { created: 0, updated: 0, absent: 0, reappeared: 0, unchanged: 1 }
    );
    assert.deepEqual(
      reconcileMirroredEvents(
        database,
        snapshot('2026-07-25T01:12:00.000Z', [event('Monitoring provider recovery')]),
        { sourceUrl }
      ),
      { created: 0, updated: 1, absent: 0, reappeared: 0, unchanged: 0 }
    );
    assert.deepEqual(
      reconcileMirroredEvents(database, snapshot('2026-07-25T01:13:00.000Z', []), {
        sourceUrl,
      }),
      { created: 0, updated: 0, absent: 1, reappeared: 0, unchanged: 0 }
    );
    assert.deepEqual(
      reconcileMirroredEvents(database, snapshot('2026-07-25T01:14:00.000Z', []), {
        sourceUrl,
      }),
      { created: 0, updated: 0, absent: 0, reappeared: 0, unchanged: 0 }
    );
    assert.deepEqual(
      reconcileMirroredEvents(
        database,
        snapshot('2026-07-25T01:15:00.000Z', [event('Monitoring provider recovery')]),
        { sourceUrl }
      ),
      { created: 0, updated: 0, absent: 0, reappeared: 1, unchanged: 0 }
    );

    const listed = listMirroredEvents(database, [{ sourceId: 'provider', pageId: 'public' }]);
    assert.equal(listed.length, 1);
    assert.deepEqual(
      {
        origin: listed[0]?.origin,
        notificationEligible: listed[0]?.notificationEligible,
        presence: listed[0]?.presence,
        version: listed[0]?.version,
        content: listed[0]?.content,
        sourceUrl: listed[0]?.source.url,
      },
      {
        origin: 'mirrored',
        notificationEligible: false,
        presence: 'present',
        version: 4,
        content: 'Monitoring provider recovery',
        sourceUrl: 'https://status.example.com/public',
      }
    );
    const timeline = getMirroredEventTimeline(
      database,
      [{ sourceId: 'provider', pageId: 'public' }],
      listed[0]!.id
    );
    assert.deepEqual(
      timeline?.entries.map(entry => entry.observationKind),
      ['initial', 'updated', 'absent', 'reappeared']
    );
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get() as {
          count: number;
        }
      ).count,
      0
    );
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM event_publications').get() as {
          count: number;
        }
      ).count,
      0
    );
    assert.equal(
      (database.prepare('SELECT COUNT(*) AS count FROM native_events').get() as { count: number })
        .count,
      0
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects duplicate upstream identities and ignores sources without incident capability', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-mirrored-validation-'));
  const databasePath = resolve(directory, 'mirrored.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    assert.throws(
      () =>
        reconcileMirroredEvents(
          database,
          snapshot('2026-07-25T02:00:00.000Z', [event(), event('Duplicate')]),
          { sourceUrl: 'https://status.example.com' }
        ),
      /unique kind and sourceEventId/u
    );
    const unsupported = snapshot('2026-07-25T02:01:00.000Z', []);
    unsupported.capabilities.incidents = 'none';
    assert.deepEqual(
      reconcileMirroredEvents(database, unsupported, {
        sourceUrl: 'https://status.example.com',
      }),
      { created: 0, updated: 0, absent: 0, reappeared: 0, unchanged: 0 }
    );
    assert.deepEqual(
      listMirroredEvents(database, [{ sourceId: 'provider', pageId: 'public' }]),
      []
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

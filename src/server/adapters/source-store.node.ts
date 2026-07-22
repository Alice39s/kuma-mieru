import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { createCachedSourceRequester } from './http-client.js';
import {
  getSourceSnapshot,
  getSourceSnapshotState,
  recordSourceFailure,
  saveSourceSnapshot,
} from './source-store.js';
import { normalizeUptimeKumaSnapshot } from './uptime-kuma/normalize.js';

test('persists last-known-good snapshots while marking later failures stale', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-source-store-'));
  const databasePath = resolve(directory, 'test.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const snapshot = normalizeUptimeKumaSnapshot({
      sourceId: 'primary',
      pageId: 'main',
      page: {
        config: { title: 'Status', description: '' },
        publicGroupList: [],
        maintenanceList: [],
      },
      heartbeat: { heartbeatList: {}, uptimeList: {} },
      fetchedAt: new Date('2026-07-23T00:00:00.000Z'),
    });
    saveSourceSnapshot(database, snapshot, new Date('2026-07-23T00:03:00.000Z'));
    recordSourceFailure(
      database,
      'primary',
      'main',
      'http_503',
      new Date('2026-07-23T00:05:00.000Z')
    );

    assert.deepEqual(getSourceSnapshot(database, 'primary', 'main'), snapshot);
    assert.equal(getSourceSnapshotState(database, 'primary', 'main')?.health.state, 'stale');
    const health = database
      .prepare(
        `SELECT state, error_code, consecutive_failures
         FROM source_health WHERE source_id = 'primary' AND page_id = 'main'`
      )
      .get() as { state: string; error_code: string; consecutive_failures: number };
    assert.deepEqual(health, { state: 'stale', error_code: 'http_503', consecutive_failures: 1 });
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('reuses validated payloads when an upstream endpoint returns 304', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-source-cache-'));
  const databasePath = resolve(directory, 'test.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    let requests = 0;
    const requester = createCachedSourceRequester(database, 'primary', async (_url, headers) => {
      requests += 1;
      if (requests === 1) {
        return { status: 200, data: { value: 42 }, etag: '"fixture-v1"', lastModified: null };
      }
      assert.equal(headers?.['If-None-Match'], '"fixture-v1"');
      return { status: 304, data: null, etag: '"fixture-v1"', lastModified: null };
    });
    const schema = z.object({ value: z.number() });
    const first = await requester.request(
      new URL('https://status.example.com/api/status-page/main'),
      'page:main',
      schema
    );
    const second = await requester.request(
      new URL('https://status.example.com/api/status-page/main'),
      'page:main',
      schema
    );
    assert.deepEqual(first, { value: 42 });
    assert.deepEqual(second, first);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

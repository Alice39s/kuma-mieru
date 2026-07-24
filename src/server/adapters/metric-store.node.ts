import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { dueMetricWindows, getMetricWindowStates, saveMetricWindow } from './metric-store.js';

test('persists a generic metric extension independently from the source snapshot', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-metric-store-'));
  const databasePath = resolve(directory, 'test.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    saveMetricWindow(
      database,
      'llm',
      'default',
      '5m',
      {
        catalog: [
          {
            id: 'latency',
            unit: 'milliseconds',
            minimumSamples: { p50: 10 },
            presentationHint: 'distribution',
          },
        ],
        series: [
          {
            metricId: 'latency',
            unit: 'milliseconds',
            window: '5m',
            generatedAt: '2026-07-25T00:00:00Z',
            points: [
              {
                window: {
                  start: '2026-07-24T23:55:00Z',
                  end: '2026-07-25T00:00:00Z',
                },
                dimensions: { region: 'ap-northeast-tyo' },
                protocolVersion: '1.0',
                sampleCount: 10,
                eligibleCount: 10,
                value: { p50: 420 },
                freshness: {
                  state: 'fresh',
                  observedAt: '2026-07-24T23:59:00Z',
                },
                coverageState: 'active',
                limitations: [],
              },
            ],
          },
        ],
      },
      new Date(Date.now() + 60_000)
    );

    const states = getMetricWindowStates(database, 'llm', 'default');
    assert.equal(states[0]?.stale, false);
    assert.equal(states[0]?.extension.catalog[0]?.id, 'latency');
    assert.equal(states[0]?.extension.series[0]?.points[0]?.dimensions.region, 'ap-northeast-tyo');
    assert.deepEqual(dueMetricWindows(states, Date.now(), 2), ['1h', '1d']);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('selects at most two missing or expired windows in stable priority order', () => {
  const now = Date.parse('2026-07-25T12:00:00Z');
  const state = (window: '5m' | '1h' | '1d' | '7d' | '30d', ageMs: number) => ({
    sourceId: 'llm',
    pageId: 'default',
    window,
    extension: { catalog: [], series: [] },
    fetchedAt: new Date(now - ageMs).toISOString(),
    staleAfter: new Date(now + 60_000).toISOString(),
    stale: false,
  });
  assert.deepEqual(
    dueMetricWindows(
      [
        state('5m', 4 * 60_000),
        state('1h', 16 * 60_000),
        state('1d', 30 * 60_000),
        state('7d', 7 * 60 * 60_000),
      ],
      now,
      2
    ),
    ['1h', '7d']
  );
});

test('migration 9 preserves the existing metric cache as the 5m window', async () => {
  const { database } = openDatabase(':memory:');
  try {
    const migration8 = await readFile(
      resolve(process.cwd(), 'migrations/000008_source_metric_extensions.up.sql'),
      'utf8'
    );
    const migration9 = await readFile(
      resolve(process.cwd(), 'migrations/000009_metric_windows_and_methodology.up.sql'),
      'utf8'
    );
    database.exec(migration8);
    database
      .prepare(
        `INSERT INTO source_metric_extensions
          (source_id, page_id, extension_json, content_hash, fetched_at, stale_after)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'llm',
        'default',
        JSON.stringify({ catalog: [], series: [] }),
        'fixture-hash',
        '2026-07-25T00:00:00Z',
        '2026-07-25T00:15:00Z'
      );
    database.exec(migration9);

    const row = database
      .prepare(
        `SELECT source_id, page_id, window, content_hash
         FROM source_metric_extensions`
      )
      .get() as Record<string, string>;
    assert.deepEqual(row, {
      source_id: 'llm',
      page_id: 'default',
      window: '5m',
      content_hash: 'fixture-hash',
    });
  } finally {
    database.close();
  }
});

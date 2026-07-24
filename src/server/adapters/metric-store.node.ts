import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { getMetricExtensionState, saveMetricExtension } from './metric-store.js';

test('persists a generic metric extension independently from the source snapshot', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-metric-store-'));
  const databasePath = resolve(directory, 'test.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    saveMetricExtension(
      database,
      'llm',
      'default',
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

    const state = getMetricExtensionState(database, 'llm', 'default');
    assert.equal(state?.stale, false);
    assert.equal(state?.extension.catalog[0]?.id, 'latency');
    assert.equal(state?.extension.series[0]?.points[0]?.dimensions.region, 'ap-northeast-tyo');
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

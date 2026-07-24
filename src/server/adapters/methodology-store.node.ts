import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { getMethodologyState, saveMethodology } from './methodology-store.js';

test('persists the producer methodology snapshot without rewriting its evidence', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-methodology-store-'));
  const databasePath = resolve(directory, 'test.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    saveMethodology(
      database,
      'llm',
      'default',
      {
        methodologyVersion: '1.0',
        generatedAt: '2026-07-25T00:00:00Z',
        product: { name: 'LLM-Mieru', measurementKind: 'third_party_synthetic' },
        sourceKinds: ['synthetic_probe'],
        statusSemantics: { unknownIsHealthy: false },
        freshnessPolicy: { missingEvidence: 'unknown' },
        protocols: [{ id: 'standard', version: '1.0' }],
        metrics: [],
        coverage: [],
        performanceBaselines: [],
        thresholdSet: null,
        limitations: ['fixture_not_live_provider_evidence'],
        evidenceLinks: ['docs/contracts/llm-measurement-protocol.md'],
      },
      new Date(Date.now() + 60_000)
    );

    const state = getMethodologyState(database, 'llm', 'default');
    assert.equal(state?.snapshot.product.name, 'LLM-Mieru');
    assert.equal(state?.snapshot.statusSemantics.unknownIsHealthy, false);
    assert.equal(state?.snapshot.thresholdSet, null);
    assert.equal(state?.stale, false);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

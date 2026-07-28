import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { OperationState } from './gen/kuma/mieru/control/v1/control_pb.js';
import { createOperationStore } from './operations.js';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';

test('operation ledger enforces idempotency and explicit uncertain-outcome resolution', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-control-operations-'));
  const databasePath = resolve(directory, 'control.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const operations = createOperationStore(database, 'control-operation-test-secret');
    const input = {
      requestId: 'request:create:0001',
      principalId: 'test-principal',
      providerId: 'uptime-robot',
      action: 'monitor.create',
      payload: { url: 'https://example.com/' },
    };
    const first = operations.begin(input);
    assert.equal(first.replay, false);
    assert.equal(first.operation.state, OperationState.PENDING);

    const replay = operations.begin(input);
    assert.equal(replay.replay, true);
    assert.equal(replay.operation.requestId, input.requestId);
    assert.throws(
      () => operations.begin({ ...input, payload: { url: 'https://changed.example/' } }),
      error => (error as { code?: string }).code === 'already_exists'
    );
    for (const changedIdentity of [
      { principalId: 'other-principal' },
      { providerId: 'better-stack' },
      { action: 'monitor.update' },
    ]) {
      assert.throws(
        () => operations.begin({ ...input, ...changedIdentity }),
        error => (error as { code?: string }).code === 'already_exists'
      );
    }

    const uncertain = operations.complete(input.requestId, {
      state: 'outcome_unknown',
      errorCode: 'provider_timeout_after_send',
    });
    assert.equal(uncertain.state, OperationState.OUTCOME_UNKNOWN);
    assert.throws(
      () => operations.resolve(input.requestId, true),
      error => (error as { code?: string }).code === 'invalid_argument'
    );
    const resolved = operations.resolve(input.requestId, true, 'external-monitor-1');
    assert.equal(resolved.state, OperationState.RESOLVED_APPLIED);
    assert.equal(resolved.externalId, 'external-monitor-1');
    assert.equal(operations.list(10, 0).length, 1);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

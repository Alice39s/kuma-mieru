import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { mutateManagedConfig, rollbackManagedConfig } from './managed-config.js';
import { createManagedRevision, getActiveRevision, listManagedRevisions } from './repository.js';

const createFixture = async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-managed-config-'));
  const databasePath = resolve(directory, 'test.sqlite3');
  const { database } = openDatabase(databasePath);
  await migrateDatabase(database, {
    directory: resolve(process.cwd(), 'migrations'),
    databasePath,
  });
  const initial = createManagedRevision(
    database,
    { schemaVersion: 1, server: {}, sources: [], pages: [] },
    'system:bootstrap'
  );
  return { directory, database, initial };
};

const audit = {
  actorId: 'user:owner',
  requestId: 'request-1',
  ipAddress: '127.0.0.1',
  userAgent: 'node-test',
};

test('appends and atomically activates a managed revision with an audit record', async () => {
  const fixture = await createFixture();
  try {
    const next = mutateManagedConfig(fixture.database, {
      expectedRevision: fixture.initial.revision,
      audit,
      action: 'source.create',
      targetType: 'source',
      targetId: 'primary',
      mutate: config => ({
        ...config,
        sources: [
          ...config.sources,
          {
            id: 'primary',
            kind: 'uptime-kuma',
            baseUrl: 'https://status.example.com',
            pageIds: ['main'],
          },
        ],
      }),
    });
    assert.equal(next.revision, fixture.initial.revision + 1);
    assert.equal(getActiveRevision(fixture.database)?.revision, next.revision);
    const auditRow = fixture.database
      .prepare('SELECT actor_id, action, target_id, result FROM admin_audit')
      .get() as Record<string, unknown>;
    assert.deepEqual(auditRow, {
      actor_id: 'user:owner',
      action: 'source.create',
      target_id: 'primary',
      result: 'success',
    });
  } finally {
    fixture.database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('rejects a stale expected revision without writing config or audit rows', async () => {
  const fixture = await createFixture();
  try {
    assert.throws(
      () =>
        mutateManagedConfig(fixture.database, {
          expectedRevision: fixture.initial.revision + 1,
          audit,
          action: 'page.create',
          targetType: 'page',
          mutate: config => config,
        }),
      error =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'config_revision_conflict'
    );
    assert.equal(listManagedRevisions(fixture.database).length, 1);
    assert.equal(
      (
        fixture.database.prepare('SELECT COUNT(*) AS count FROM admin_audit').get() as {
          count: number;
        }
      ).count,
      0
    );
  } finally {
    fixture.database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('rollback creates a new revision instead of reactivating or deleting history', async () => {
  const fixture = await createFixture();
  try {
    const changed = mutateManagedConfig(fixture.database, {
      expectedRevision: fixture.initial.revision,
      audit,
      action: 'page.create',
      targetType: 'page',
      targetId: 'public',
      mutate: config => ({
        ...config,
        sources: [
          {
            id: 'primary',
            kind: 'uptime-kuma',
            baseUrl: 'https://status.example.com',
            pageIds: ['main'],
          },
        ],
        pages: [{ id: 'public', slug: 'main', title: 'Status', sourceRefs: ['primary'] }],
      }),
    });
    const rolledBack = rollbackManagedConfig(fixture.database, {
      expectedRevision: changed.revision,
      targetRevision: fixture.initial.revision,
      audit: { ...audit, requestId: 'request-2' },
      action: 'config.rollback',
      targetType: 'config_revision',
    });
    assert.equal(rolledBack.revision, changed.revision + 1);
    assert.equal(rolledBack.contentHash, fixture.initial.contentHash);
    assert.deepEqual(
      listManagedRevisions(fixture.database).map(revision => revision.revision),
      [rolledBack.revision, changed.revision, fixture.initial.revision]
    );
  } finally {
    fixture.database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

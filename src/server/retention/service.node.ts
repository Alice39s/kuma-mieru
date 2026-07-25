import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { createBackupService, restoreBackupArtifact } from '../db/backup.js';
import { openDatabase } from '../db/database.js';
import { migrateDatabase, verifyDatabase } from '../db/migrator.js';
import {
  clearPostRestoreRetentionMarker,
  readPostRestoreRetentionMarker,
} from './restore-marker.js';
import { createRetentionService, runRetentionScheduleOnce } from './service.js';
import { createSubscriberTombstoneStore } from './tombstone-store.js';

const migrationDirectory = resolve(process.cwd(), 'migrations');
const now = new Date('2026-07-25T12:00:00.000Z');
const old = '2025-01-01T00:00:00.000Z';
const recent = '2026-07-25T00:00:00.000Z';

const insertSubscription = (
  database: ReturnType<typeof openDatabase>['database'],
  input: {
    id: string;
    state: 'pending_confirmation' | 'active' | 'unsubscribed' | 'suppressed' | 'expired';
    updatedAt: string;
    scopeKey?: string;
    emailHash?: string;
  }
) => {
  database
    .prepare(
      `INSERT INTO email_subscriptions
        (id, page_id, incident_id, scope_key, component_ids_json, email_hash,
         email_ciphertext, state, created_at, confirmed_at, updated_at)
       VALUES (?, 'page', NULL, ?, '[]', ?, 'encrypted-email', ?, ?, NULL, ?)`
    )
    .run(
      input.id,
      input.scopeKey ?? 'page:*',
      input.emailHash ?? input.id.padEnd(64, '0').slice(0, 64),
      input.state,
      input.updatedAt,
      input.updatedAt
    );
};

const insertOutbox = (
  database: ReturnType<typeof openDatabase>['database'],
  input: {
    id: string;
    subscriptionId: string;
    state: 'queued' | 'processing' | 'sent' | 'failed' | 'dead_letter';
    createdAt: string;
  }
) => {
  database
    .prepare(
      `INSERT INTO notification_outbox
        (id, publication_id, subscription_id, channel, kind, idempotency_key, state,
         attempts, next_attempt_at, payload_ciphertext, created_at)
       VALUES (?, NULL, ?, 'email', 'subscription_confirmation', ?, ?, 0, ?,
               'encrypted-payload', ?)`
    )
    .run(
      input.id,
      input.subscriptionId,
      `idempotency:${input.id}`,
      input.state,
      input.createdAt,
      input.createdAt
    );
};

test('previews and executes bounded retention without deleting published history', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-retention-'));
  const databasePath = resolve(directory, 'kuma-mieru.sqlite3');
  const { database } = openDatabase(databasePath);
  const tombstones = createSubscriberTombstoneStore(directory);
  try {
    await migrateDatabase(database, {
      directory: migrationDirectory,
      databasePath,
      appBuild: 'retention-test',
    });

    insertSubscription(database, {
      id: 'pending-old',
      state: 'pending_confirmation',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    insertOutbox(database, {
      id: 'pending-outbox',
      subscriptionId: 'pending-old',
      state: 'queued',
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    insertSubscription(database, {
      id: 'pending-processing',
      state: 'pending_confirmation',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    insertOutbox(database, {
      id: 'processing-outbox',
      subscriptionId: 'pending-processing',
      state: 'processing',
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    database
      .prepare(
        `INSERT INTO subscription_tokens
          (id, subscription_id, purpose, token_hash, expires_at, created_at)
         VALUES ('pending-token', 'pending-old', 'confirm', 'pending-token-hash',
                 '2026-07-02T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`
      )
      .run();

    insertSubscription(database, {
      id: 'terminal-old',
      state: 'unsubscribed',
      updatedAt: old,
    });
    insertOutbox(database, {
      id: 'terminal-outbox',
      subscriptionId: 'terminal-old',
      state: 'sent',
      createdAt: old,
    });

    insertSubscription(database, {
      id: 'restored-active',
      state: 'active',
      updatedAt: '2026-01-01T00:00:00.000Z',
      scopeKey: 'components:api',
      emailHash: 'a'.repeat(64),
    });
    tombstones.record({
      pageId: 'page',
      scopeKey: 'components:api',
      emailHash: 'a'.repeat(64),
      state: 'unsubscribed',
      recordedAt: '2026-02-01T00:00:00.000Z',
    });

    database
      .prepare(
        `INSERT INTO public_rate_limits (key_hash, bucket_started_at, request_count)
         VALUES ('old-rate', ?, 1), ('recent-rate', ?, 1)`
      )
      .run(old, recent);
    const insertOldRateLimit = database.prepare(
      `INSERT INTO public_rate_limits (key_hash, bucket_started_at, request_count)
       VALUES (?, ?, 1)`
    );
    for (let index = 0; index < 300; index += 1) {
      insertOldRateLimit.run(`old-rate-${index}`, old);
    }
    database
      .prepare(
        `INSERT INTO admin_audit
          (id, occurred_at, actor_id, action, target_type, request_id, result)
         VALUES ('old-audit', ?, 'owner', 'old', 'fixture', 'old-request', 'success'),
                ('recent-audit', ?, 'owner', 'recent', 'fixture', 'recent-request', 'success')`
      )
      .run(old, recent);

    for (const [id, published] of [
      ['unpublished-terminal', false],
      ['published-terminal', true],
    ] as const) {
      database
        .prepare(
          `INSERT INTO native_events
            (id, type, page_id, title, state, version, created_by, idempotency_key,
             request_hash, created_at, updated_at)
           VALUES (?, 'incident', 'page', ?, 'resolved', 1, 'owner', ?, ?, ?, ?)`
        )
        .run(id, id, `key:${id}`, `hash:${id}`, old, old);
      database
        .prepare(
          `INSERT INTO native_event_entries
            (id, event_id, sequence, kind, state, title, body, affected_components_json,
             occurred_at, recorded_at, actor_id)
           VALUES (?, ?, 1, 'created', 'resolved', ?, 'body', '[]', ?, ?, 'owner')`
        )
        .run(`entry:${id}`, id, id, old, old);
      if (published) {
        database
          .prepare(
            `INSERT INTO event_publications
              (id, event_id, event_sequence, page_id, content_json, notify_subscribers,
               subscriber_scope_json, estimated_recipients, actor_id, published_at)
             VALUES ('publication:published', ?, 1, 'page', '{}', 0, '{}', 0, 'owner', ?)`
          )
          .run(id, old);
      }
    }
    database
      .prepare(
        `INSERT INTO native_events
          (id, type, page_id, title, state, version, created_by, idempotency_key,
           request_hash, created_at, updated_at)
         VALUES ('parent-with-child', 'incident', 'page', 'Parent', 'resolved', 1, 'owner',
                 'key:parent', 'hash:parent', ?, ?),
                ('child-draft', 'postmortem', 'page', 'Child', 'draft', 1, 'owner',
                 'key:child', 'hash:child', ?, ?)`
      )
      .run(old, old, old, old);
    database
      .prepare(
        `UPDATE native_events SET parent_event_id = 'parent-with-child'
         WHERE id = 'child-draft'`
      )
      .run();

    database
      .prepare(
        `INSERT INTO backup_artifacts
          (id, state, file_name, created_by, created_at, completed_at)
         VALUES ('old-backup', 'failed', 'old.sqlite3', 'system', ?, ?),
                ('recent-backup', 'failed', 'recent.sqlite3', 'system', ?, ?),
                ('held-backup', 'failed', 'held.sqlite3', 'system', ?, ?)`
      )
      .run(old, old, recent, recent, old, old);
    database
      .prepare("UPDATE backup_artifacts SET retention_state = 'hold' WHERE id = 'held-backup'")
      .run();

    const service = createRetentionService({
      database,
      tombstones,
      now: () => new Date(now),
    });
    const preview = service.preview();
    assert.equal(preview.candidates.pendingSubscriptionsExpired, 1);
    assert.equal(preview.candidates.unpublishedTerminalEventsDeleted, 1);
    assert.equal(preview.candidates.backupArtifactsMarkedEligible, 1);

    const run = await service.run('admin', 'owner');
    assert.equal(run.state, 'completed');
    assert.equal(run.summary?.subscriberTombstonesApplied, 1);
    assert.equal(run.summary?.pendingSubscriptionsExpired, 1);
    assert.equal(run.summary?.unpublishedTerminalEventsDeleted, 1);
    assert.equal(run.summary?.adminAuditRowsDeleted, 1);
    assert.equal(run.summary?.abuseRateLimitBucketsDeleted, 301);
    assert.equal(run.summary?.backupArtifactsMarkedEligible, 1);

    assert.deepEqual(
      database
        .prepare(
          `SELECT id, state, email_ciphertext, pii_deleted_at
           FROM email_subscriptions ORDER BY id`
        )
        .all(),
      [
        {
          id: 'pending-old',
          state: 'expired',
          email_ciphertext: '',
          pii_deleted_at: now.toISOString(),
        },
        {
          id: 'pending-processing',
          state: 'pending_confirmation',
          email_ciphertext: 'encrypted-email',
          pii_deleted_at: null,
        },
        {
          id: 'restored-active',
          state: 'unsubscribed',
          email_ciphertext: '',
          pii_deleted_at: '2026-02-01T00:00:00.000Z',
        },
        {
          id: 'terminal-old',
          state: 'unsubscribed',
          email_ciphertext: '',
          pii_deleted_at: now.toISOString(),
        },
      ]
    );
    assert.deepEqual(database.prepare('SELECT id FROM native_events ORDER BY id').all(), [
      { id: 'child-draft' },
      { id: 'parent-with-child' },
      { id: 'published-terminal' },
    ]);
    assert.deepEqual(database.prepare('SELECT id FROM admin_audit ORDER BY id').all(), [
      { id: 'recent-audit' },
    ]);
    assert.deepEqual(
      database.prepare('SELECT key_hash FROM public_rate_limits ORDER BY key_hash').all(),
      [{ key_hash: 'recent-rate' }]
    );
    assert.deepEqual(
      database.prepare('SELECT id, retention_state FROM backup_artifacts ORDER BY id').all(),
      [
        { id: 'held-backup', retention_state: 'hold' },
        { id: 'old-backup', retention_state: 'eligible' },
        { id: 'recent-backup', retention_state: 'current' },
      ]
    );
    verifyDatabase(database);

    const repeated = await service.run('scheduler', 'system:test');
    assert.equal(
      Object.values(repeated.summary ?? {}).reduce((total, value) => total + value, 0),
      0
    );
    assert.equal(
      await runRetentionScheduleOnce({
        service,
        now: () => new Date('2026-07-25T13:00:00.000Z'),
      }),
      'current'
    );
  } finally {
    tombstones.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects concurrent runs and records the surviving run once', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-retention-concurrency-'));
  const databasePath = resolve(directory, 'kuma-mieru.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: migrationDirectory,
      databasePath,
      appBuild: 'retention-test',
    });
    for (let index = 0; index < 300; index += 1) {
      database
        .prepare(
          `INSERT INTO admin_audit
            (id, occurred_at, actor_id, action, target_type, request_id, result)
           VALUES (?, ?, 'owner', 'old', 'fixture', ?, 'success')`
        )
        .run(`audit-${index}`, old, `request-${index}`);
    }
    const service = createRetentionService({
      database,
      now: () => new Date(now),
    });
    const first = service.run('admin', 'owner');
    await assert.rejects(service.run('admin', 'owner'), error => {
      assert.equal((error as { code: string }).code, 'retention_in_progress');
      return true;
    });
    await first;
    assert.equal(service.list().filter(run => run.state === 'completed').length, 1);
    database
      .prepare(
        `INSERT INTO retention_runs
          (id, policy_version, run_trigger, actor_id, state, cutoffs_json, started_at)
         VALUES ('ret_interrupted', 1, 'scheduler', 'system:test', 'running', '{}', ?)`
      )
      .run(recent);
    const recovered = createRetentionService({
      database,
      now: () => new Date(now),
    })
      .list()
      .find(run => run.id === 'ret_interrupted');
    assert.equal(recovered?.state, 'failed');
    assert.equal(recovered?.errorCode, 'retention_interrupted');
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('reapplies external subscriber tombstones after restoring an older backup', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-retention-restore-'));
  const databasePath = resolve(directory, 'kuma-mieru.sqlite3');
  const opened = openDatabase(databasePath);
  const tombstones = createSubscriberTombstoneStore(directory);
  try {
    assert.equal((await stat(resolve(directory, '.retention'))).mode & 0o777, 0o700);
    assert.equal(
      (await stat(resolve(directory, '.retention', 'subscriber-tombstones.sqlite3'))).mode & 0o777,
      0o600
    );
    await migrateDatabase(opened.database, {
      directory: migrationDirectory,
      databasePath,
      appBuild: 'retention-test',
    });
    insertSubscription(opened.database, {
      id: 'restored-subscriber',
      state: 'active',
      updatedAt: '2026-01-01T00:00:00.000Z',
      scopeKey: 'components:api',
      emailHash: 'c'.repeat(64),
    });
    const backupService = createBackupService({
      database: opened.database,
      databasePath,
      dataDirectory: directory,
      migrationDirectory,
      appBuild: 'retention-test',
    });
    await backupService.recoverInterrupted();
    const backup = await backupService.create('owner');
    tombstones.record({
      pageId: 'page',
      scopeKey: 'components:api',
      emailHash: 'c'.repeat(64),
      state: 'unsubscribed',
      recordedAt: '2026-02-01T00:00:00.000Z',
    });
    opened.database
      .prepare(
        `UPDATE email_subscriptions
         SET state = 'unsubscribed', email_ciphertext = '', pii_deleted_at = ?, updated_at = ?
         WHERE id = 'restored-subscriber'`
      )
      .run('2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    opened.database.close();

    await restoreBackupArtifact({
      backupId: backup.backupId,
      dataDirectory: directory,
      databasePath,
      migrationDirectory,
      now: () => new Date('2026-07-25T12:00:00.000Z'),
    });
    assert.equal((await readPostRestoreRetentionMarker(directory))?.backupId, backup.backupId);

    const restored = openDatabase(databasePath);
    try {
      await migrateDatabase(restored.database, {
        directory: migrationDirectory,
        databasePath,
        appBuild: 'retention-test',
      });
      const service = createRetentionService({
        database: restored.database,
        tombstones,
        now: () => new Date(now),
      });
      const run = await service.run('restore', `system:restore:${backup.backupId}`);
      assert.equal(run.summary?.subscriberTombstonesApplied, 1);
      assert.deepEqual(
        restored.database
          .prepare(
            `SELECT state, email_ciphertext, pii_deleted_at
             FROM email_subscriptions WHERE id = 'restored-subscriber'`
          )
          .get(),
        {
          state: 'unsubscribed',
          email_ciphertext: '',
          pii_deleted_at: '2026-02-01T00:00:00.000Z',
        }
      );
      await clearPostRestoreRetentionMarker(directory);
      assert.equal(await readPostRestoreRetentionMarker(directory), null);
    } finally {
      restored.database.close();
    }
  } finally {
    tombstones.close();
    if (opened.database.open) opened.database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a symlink subscriber tombstone store', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-retention-symlink-'));
  try {
    const retentionDirectory = resolve(directory, '.retention');
    await mkdir(retentionDirectory, { mode: 0o700 });
    await symlink(
      resolve(directory, 'outside.sqlite3'),
      resolve(retentionDirectory, 'subscriber-tombstones.sqlite3')
    );
    assert.throws(
      () => createSubscriberTombstoneStore(directory),
      error => {
        assert.equal((error as { code: string }).code, 'retention_tombstone_store_unsafe');
        return true;
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { restoreBackupArtifact } from './db/backup.js';
import { openDatabase } from './db/database.js';
import { migrateDatabase } from './db/migrator.js';
import { readPostRestoreRetentionMarker } from './retention/restore-marker.js';
import { createSubscriberTombstoneStore } from './retention/tombstone-store.js';

const migrationDirectory = resolve(process.cwd(), 'migrations');

const listen = (server: Server) =>
  new Promise<number>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      resolveListen(address.port);
    });
  });

const close = (server: Server) =>
  new Promise<void>((resolveClose, rejectClose) => {
    server.close(error => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });

const availablePort = async () => {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
};

const stopChild = async (child: ChildProcessWithoutNullStreams) => {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Kuma Mieru did not stop after SIGTERM')), 5_000).unref();
    }),
  ]);
};

test('restores schema 16, backfills lifecycle, and reaches readiness on schema 21', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-restore-upgrade-runtime-'));
  const dataDirectory = resolve(root, 'data');
  const databasePath = resolve(dataDirectory, 'kuma-mieru.sqlite3');
  const previousMigrationDirectory = resolve(root, 'schema-16-migrations');
  const configPath = resolve(root, 'config.json');
  const migrationNames = (await readdir(migrationDirectory))
    .filter(name => name.endsWith('.up.sql'))
    .sort();
  assert.equal(migrationNames.length, 21);
  await mkdir(previousMigrationDirectory, { recursive: true });
  for (const name of migrationNames.slice(0, 16)) {
    await copyFile(resolve(migrationDirectory, name), resolve(previousMigrationDirectory, name));
  }
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      server: {},
      sources: [],
      pages: [],
    }),
    { mode: 0o600 }
  );

  let child: ChildProcessWithoutNullStreams | null = null;
  const output: string[] = [];
  const initial = openDatabase(databasePath);
  const tombstones = createSubscriberTombstoneStore(dataDirectory);
  try {
    const schema16 = await migrateDatabase(initial.database, {
      directory: previousMigrationDirectory,
      databasePath,
      appBuild: '2.0.0-previous',
    });
    assert.equal(schema16.currentVersion, 16);
    initial.database
      .prepare(
        `INSERT INTO email_subscriptions
          (id, page_id, incident_id, scope_key, component_ids_json, email_hash,
           email_ciphertext, state, created_at, confirmed_at, updated_at)
         VALUES ('restore-upgrade-subscriber', 'page', NULL, 'components:api', '["api"]', ?,
                 'encrypted-old-address', 'active', ?, ?, ?)`
      )
      .run(
        'd'.repeat(64),
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      );
    const maintenanceDetails = JSON.stringify({
      scheduledStartAt: '2000-01-02T01:00:00+00:00',
      scheduledEndAt: '2000-01-02T02:00:00+00:00',
    });
    initial.database
      .prepare(
        `INSERT INTO native_events
          (id, type, page_id, title, state, version, created_by, idempotency_key,
           request_hash, created_at, updated_at, details_json)
         VALUES ('restore-upgrade-maintenance', 'maintenance', 'page', 'Upgrade maintenance',
                 'scheduled', 2, 'owner-1', 'restore-upgrade-maintenance', 'request-hash',
                 '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:01.000Z', ?)`
      )
      .run(maintenanceDetails);
    initial.database
      .prepare(
        `INSERT INTO native_event_entries
          (id, event_id, sequence, kind, state, title, body, affected_components_json,
           occurred_at, recorded_at, actor_id, details_json)
         VALUES
          ('restore-upgrade-maintenance-entry-1', 'restore-upgrade-maintenance', 1, 'created',
           'draft', 'Upgrade maintenance', 'Initial draft.', '["api"]',
           '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', 'owner-1', ?),
          ('restore-upgrade-maintenance-entry-2', 'restore-upgrade-maintenance', 2, 'update',
           'scheduled', 'Upgrade maintenance', 'Reviewed schedule.', '["api"]',
           '2000-01-01T00:00:01.000Z', '2000-01-01T00:00:01.000Z', 'owner-1', ?)`
      )
      .run(maintenanceDetails, maintenanceDetails);
    initial.database
      .prepare(
        `INSERT INTO event_publications
          (id, event_id, event_sequence, page_id, content_json, notify_subscribers,
           subscriber_scope_json, estimated_recipients, actor_id, published_at)
         VALUES ('restore-upgrade-maintenance-publication-2', 'restore-upgrade-maintenance', 2,
                 'page', '{}', 1, '{"kind":"page","componentIds":[]}', 0, 'owner-1',
                 '2000-01-01T00:00:02.000Z')`
      )
      .run();

    const firstUpgrade = await migrateDatabase(initial.database, {
      directory: migrationDirectory,
      databasePath,
      appBuild: '2.0.0-current',
    });
    assert.equal(firstUpgrade.currentVersion, 21);
    assert.ok(firstUpgrade.backupArtifactId);
    assert.equal(
      (
        initial.database
          .prepare(
            `SELECT lifecycle_due_at FROM native_events
             WHERE id = 'restore-upgrade-maintenance'`
          )
          .get() as { lifecycle_due_at: string | null }
      ).lifecycle_due_at,
      null
    );
    tombstones.record({
      pageId: 'page',
      scopeKey: 'components:api',
      emailHash: 'd'.repeat(64),
      state: 'unsubscribed',
      recordedAt: '2026-02-01T00:00:00.000Z',
    });
    initial.database
      .prepare(
        `UPDATE email_subscriptions
         SET state = 'unsubscribed', email_ciphertext = '', pii_deleted_at = ?, updated_at = ?
         WHERE id = 'restore-upgrade-subscriber'`
      )
      .run('2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    initial.database.pragma('wal_checkpoint(TRUNCATE)');
    initial.database.close();
    await rm(`${databasePath}-wal`, { force: true });
    await rm(`${databasePath}-shm`, { force: true });

    const restored = await restoreBackupArtifact({
      backupId: firstUpgrade.backupArtifactId,
      dataDirectory,
      databasePath,
      migrationDirectory,
      now: () => new Date('2026-07-25T08:00:00.000Z'),
    });
    assert.equal(restored.schemaVersion, 16);
    assert.ok(restored.rollbackFileName);
    assert.equal(
      (await readPostRestoreRetentionMarker(dataDirectory))?.backupId,
      firstUpgrade.backupArtifactId
    );
    const restoredSchema16 = openDatabase(databasePath);
    try {
      assert.equal(
        (
          restoredSchema16.database
            .prepare('SELECT MAX(version) AS version FROM schema_migrations')
            .get() as { version: number }
        ).version,
        16
      );
      assert.equal(
        (
          restoredSchema16.database
            .prepare(
              "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'backup_deletions'"
            )
            .get() as { count: number }
        ).count,
        1
      );
      assert.deepEqual(
        restoredSchema16.database
          .prepare(
            `SELECT state, email_ciphertext, pii_deleted_at
             FROM email_subscriptions WHERE id = 'restore-upgrade-subscriber'`
          )
          .get(),
        {
          state: 'active',
          email_ciphertext: 'encrypted-old-address',
          pii_deleted_at: null,
        }
      );
      restoredSchema16.database.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      restoredSchema16.database.close();
    }
    await rm(`${databasePath}-wal`, { force: true });
    await rm(`${databasePath}-shm`, { force: true });

    const port = await availablePort();
    const processChild = spawn(process.execPath, [resolve(import.meta.dirname, 'index.js')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        KUMA_MIERU_BACKUP_SCHEDULE_ENABLED: 'false',
        KUMA_MIERU_BASE_URL: `http://127.0.0.1:${port}`,
        KUMA_MIERU_CONFIG: configPath,
        KUMA_MIERU_CONFIG_MODE: 'file',
        KUMA_MIERU_DATA_DIR: dataDirectory,
        KUMA_MIERU_MIGRATIONS_DIR: migrationDirectory,
        KUMA_MIERU_RETENTION_SCHEDULE_ENABLED: 'false',
        KUMA_MIERU_SETUP_TOKEN: 'restore-upgrade-owner-setup-token-0001',
        NODE_ENV: 'development',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child = processChild;
    processChild.stdin.end();
    processChild.stdout.setEncoding('utf8');
    processChild.stderr.setEncoding('utf8');
    processChild.stdout.on('data', chunk => output.push(String(chunk)));
    processChild.stderr.on('data', chunk => output.push(String(chunk)));

    const deadline = Date.now() + 10_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (processChild.exitCode !== null) {
        throw new Error(`Kuma Mieru exited before readiness:\n${output.join('')}`);
      }
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/health/ready`)).ok;
        if (ready) break;
      } catch {
        // Migration and mandatory retention intentionally complete before the listener binds.
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 25));
    }
    assert.equal(ready, true, `Kuma Mieru did not become ready:\n${output.join('')}`);
    const combinedOutput = output.join('');
    const backfillLog = combinedOutput.indexOf('Backfilled scheduled event lifecycle due times');
    const retentionLog = combinedOutput.indexOf('Post-restore retention completed');
    const listenerLog = combinedOutput.indexOf('Kuma Mieru v2 listening');
    assert.equal(backfillLog >= 0, true, combinedOutput);
    assert.equal(retentionLog >= 0, true, combinedOutput);
    assert.equal(
      combinedOutput.indexOf('Recovered scheduled event lifecycle transitions') >= 0,
      true,
      combinedOutput
    );
    assert.equal(listenerLog > backfillLog, true, combinedOutput);
    assert.equal(listenerLog > retentionLog, true, combinedOutput);

    const readyDatabase = openDatabase(databasePath);
    try {
      assert.equal(
        (
          readyDatabase.database
            .prepare('SELECT MAX(version) AS version FROM schema_migrations')
            .get() as { version: number }
        ).version,
        21
      );
      assert.deepEqual(
        readyDatabase.database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name IN ('event_templates', 'event_template_entries')
             ORDER BY name`
          )
          .all(),
        [{ name: 'event_template_entries' }, { name: 'event_templates' }]
      );
      assert.deepEqual(
        readyDatabase.database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table'
               AND name IN (
                 'recurring_maintenance_plans',
                 'recurring_maintenance_plan_entries',
                 'recurring_maintenance_occurrences'
               )
             ORDER BY name`
          )
          .all(),
        [
          { name: 'recurring_maintenance_occurrences' },
          { name: 'recurring_maintenance_plan_entries' },
          { name: 'recurring_maintenance_plans' },
        ]
      );
      const nativeEventColumns = readyDatabase.database
        .prepare('PRAGMA table_info(native_events)')
        .all() as Array<{ name: string }>;
      assert.equal(
        [
          'source_template_id',
          'source_template_version',
          'source_template_notify_suggestion',
        ].every(name => nativeEventColumns.some(column => column.name === name)),
        true
      );
      assert.deepEqual(
        readyDatabase.database
          .prepare(
            `SELECT state, email_ciphertext, pii_deleted_at
             FROM email_subscriptions WHERE id = 'restore-upgrade-subscriber'`
          )
          .get(),
        {
          state: 'unsubscribed',
          email_ciphertext: '',
          pii_deleted_at: '2026-02-01T00:00:00.000Z',
        }
      );
      assert.equal(
        (
          readyDatabase.database
            .prepare(
              `SELECT COUNT(*) AS count FROM retention_runs
               WHERE run_trigger = 'restore' AND state = 'completed'`
            )
            .get() as { count: number }
        ).count,
        1
      );
      assert.deepEqual(
        readyDatabase.database
          .prepare(
            `SELECT state, version, lifecycle_due_at
             FROM native_events WHERE id = 'restore-upgrade-maintenance'`
          )
          .get(),
        {
          state: 'completed',
          version: 4,
          lifecycle_due_at: null,
        }
      );
      assert.deepEqual(
        readyDatabase.database
          .prepare(
            `SELECT event_sequence, notify_subscribers, actor_id
             FROM event_publications
             WHERE event_id = 'restore-upgrade-maintenance'
             ORDER BY event_sequence`
          )
          .all(),
        [
          { event_sequence: 2, notify_subscribers: 1, actor_id: 'owner-1' },
          {
            event_sequence: 3,
            notify_subscribers: 0,
            actor_id: 'system:event-lifecycle',
          },
          {
            event_sequence: 4,
            notify_subscribers: 0,
            actor_id: 'system:event-lifecycle',
          },
        ]
      );
    } finally {
      readyDatabase.database.close();
    }
    assert.equal(await readPostRestoreRetentionMarker(dataDirectory), null);
  } finally {
    if (child) await stopChild(child).catch(() => undefined);
    tombstones.close();
    if (initial.database.open) initial.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

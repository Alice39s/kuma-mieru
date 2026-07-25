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

test('restores schema 15, reapplies tombstones, and reaches readiness on schema 16', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-restore-upgrade-runtime-'));
  const dataDirectory = resolve(root, 'data');
  const databasePath = resolve(dataDirectory, 'kuma-mieru.sqlite3');
  const previousMigrationDirectory = resolve(root, 'schema-15-migrations');
  const configPath = resolve(root, 'config.json');
  const migrationNames = (await readdir(migrationDirectory))
    .filter(name => name.endsWith('.up.sql'))
    .sort();
  assert.equal(migrationNames.length, 16);
  await mkdir(previousMigrationDirectory, { recursive: true });
  for (const name of migrationNames.slice(0, -1)) {
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
    const schema15 = await migrateDatabase(initial.database, {
      directory: previousMigrationDirectory,
      databasePath,
      appBuild: '2.0.0-previous',
    });
    assert.equal(schema15.currentVersion, 15);
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

    const firstUpgrade = await migrateDatabase(initial.database, {
      directory: migrationDirectory,
      databasePath,
      appBuild: '2.0.0-current',
    });
    assert.equal(firstUpgrade.currentVersion, 16);
    assert.ok(firstUpgrade.backupArtifactId);
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
    assert.equal(restored.schemaVersion, 15);
    assert.ok(restored.rollbackFileName);
    assert.equal(
      (await readPostRestoreRetentionMarker(dataDirectory))?.backupId,
      firstUpgrade.backupArtifactId
    );
    const restoredSchema15 = openDatabase(databasePath);
    try {
      assert.equal(
        (
          restoredSchema15.database
            .prepare('SELECT MAX(version) AS version FROM schema_migrations')
            .get() as { version: number }
        ).version,
        15
      );
      assert.equal(
        (
          restoredSchema15.database
            .prepare(
              "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'backup_deletions'"
            )
            .get() as { count: number }
        ).count,
        1
      );
      assert.deepEqual(
        restoredSchema15.database
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
      restoredSchema15.database.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      restoredSchema15.database.close();
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
    const retentionLog = combinedOutput.indexOf('Post-restore retention completed');
    const listenerLog = combinedOutput.indexOf('Kuma Mieru v2 listening');
    assert.equal(retentionLog >= 0, true, combinedOutput);
    assert.equal(listenerLog > retentionLog, true, combinedOutput);

    const readyDatabase = openDatabase(databasePath);
    try {
      assert.equal(
        (
          readyDatabase.database
            .prepare('SELECT MAX(version) AS version FROM schema_migrations')
            .get() as { version: number }
        ).version,
        16
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

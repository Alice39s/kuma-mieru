import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import {
  backupErrorCode,
  createBackupService,
  restoreBackupArtifact,
  runBackupScheduleOnce,
} from './backup.js';
import { openDatabase } from './database.js';
import { migrateDatabase } from './migrator.js';
import { acquireRuntimeLock } from './runtime-lock.js';
import { readPostRestoreRetentionMarker } from '../retention/restore-marker.js';
import { createManagedRevision } from '../config/repository.js';

const migrationDirectory = resolve(process.cwd(), 'migrations');

const createFixture = async (
  overrides: Partial<Parameters<typeof createBackupService>[0]> = {}
) => {
  const dataDirectory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-backup-'));
  const databasePath = resolve(dataDirectory, 'kuma-mieru.sqlite3');
  const { database } = openDatabase(databasePath);
  await migrateDatabase(database, {
    directory: migrationDirectory,
    databasePath,
    appBuild: 'test',
  });
  database.exec('CREATE TABLE backup_test_payload (value TEXT NOT NULL)');
  database.prepare('INSERT INTO backup_test_payload (value) VALUES (?)').run('before-backup');
  const service = createBackupService({
    database,
    databasePath,
    dataDirectory,
    migrationDirectory,
    appBuild: '2.0.0-test',
    ...overrides,
  });
  await service.recoverInterrupted();
  return { dataDirectory, databasePath, database, service };
};

test('creates a private online backup, validates it, and restores it offline', async () => {
  const fixture = await createFixture();
  try {
    const backup = await fixture.service.create('owner_fixture');
    assert.equal(backup.valid, true);
    assert.equal(fixture.service.list()[0]?.state, 'ready');

    const backupDirectory = resolve(fixture.dataDirectory, 'backups');
    const backupPath = resolve(backupDirectory, `${backup.backupId}.sqlite3`);
    const manifestPath = resolve(backupDirectory, `${backup.backupId}.manifest.json`);
    assert.equal((await stat(backupDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
    assert.equal((await stat(manifestPath)).mode & 0o777, 0o600);
    const manifestText = await readFile(manifestPath, 'utf8');
    assert.equal(manifestText.includes(fixture.dataDirectory), false);
    assert.deepEqual(await fixture.service.validate(backup.backupId), backup);

    createManagedRevision(
      fixture.database,
      {
        schemaVersion: 1,
        server: {},
        sources: [],
        pages: [],
        dataLifecycle: {
          retention: {
            eventDraftDays: 180,
            adminAuditDays: 730,
            deliveryAttemptDays: 180,
            backupDays: 60,
          },
        },
      },
      'owner'
    );
    fixture.database.prepare('INSERT INTO backup_test_payload (value) VALUES (?)').run('after');
    fixture.database.close();
    const runtimeLock = await acquireRuntimeLock({
      dataDirectory: fixture.dataDirectory,
      appBuild: 'test-holder',
    });
    try {
      const restoreCliPath = resolve(import.meta.dirname, '../cli/restore-backup.js');
      const blockedRestore = spawnSync(
        process.execPath,
        [
          restoreCliPath,
          '--backup-id',
          backup.backupId,
          '--data-dir',
          fixture.dataDirectory,
          '--execute',
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, KUMA_MIERU_MIGRATIONS_DIR: migrationDirectory },
          encoding: 'utf8',
        }
      );
      assert.notEqual(blockedRestore.status, 0);
      assert.match(blockedRestore.stderr, /"errorCode":"runtime_lock_held"/u);
    } finally {
      runtimeLock.release();
    }
    await writeFile(`${fixture.databasePath}-wal`, 'active');
    await assert.rejects(
      restoreBackupArtifact({
        backupId: backup.backupId,
        dataDirectory: fixture.dataDirectory,
        databasePath: fixture.databasePath,
        migrationDirectory,
      }),
      error => {
        assert.equal(backupErrorCode(error), 'restore_database_active');
        return true;
      }
    );
    await rm(`${fixture.databasePath}-wal`);
    const restored = await restoreBackupArtifact({
      backupId: backup.backupId,
      dataDirectory: fixture.dataDirectory,
      databasePath: fixture.databasePath,
      migrationDirectory,
      now: () => new Date('2026-07-25T00:00:00.000Z'),
    });
    assert.equal(restored.rollbackFileName?.includes('pre-restore-2026-07-25'), true);
    assert.deepEqual(await readPostRestoreRetentionMarker(fixture.dataDirectory), {
      formatVersion: 1,
      backupId: backup.backupId,
      restoredAt: '2026-07-25T00:00:00.000Z',
      retentionPolicy: {
        eventDraftDays: 180,
        adminAuditDays: 730,
        deliveryAttemptDays: 180,
        backupDays: 60,
      },
    });
    const reopened = new BetterSqlite3(fixture.databasePath, { readonly: true });
    try {
      const values = reopened
        .prepare('SELECT value FROM backup_test_payload ORDER BY rowid')
        .all() as Array<{ value: string }>;
      assert.deepEqual(values, [{ value: 'before-backup' }]);
    } finally {
      reopened.close();
    }
    assert.equal(
      (await lstat(resolve(fixture.dataDirectory, restored.rollbackFileName as string))).isFile(),
      true
    );
  } finally {
    if (fixture.database.open) fixture.database.close();
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('rejects corrupt bytes, manifest drift, unsafe IDs and symlink artifacts', async () => {
  const fixture = await createFixture();
  try {
    const first = await fixture.service.create('owner_fixture');
    const firstPath = resolve(fixture.dataDirectory, 'backups', `${first.backupId}.sqlite3`);
    const bytes = await readFile(firstPath);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(firstPath, bytes);
    await assert.rejects(fixture.service.validate(first.backupId), error => {
      assert.equal(backupErrorCode(error), 'backup_checksum_mismatch');
      return true;
    });

    const second = await fixture.service.create('owner_fixture');
    const secondManifest = resolve(
      fixture.dataDirectory,
      'backups',
      `${second.backupId}.manifest.json`
    );
    await writeFile(secondManifest, '{"formatVersion":1}\n');
    await assert.rejects(fixture.service.validate(second.backupId), error => {
      assert.equal(backupErrorCode(error), 'backup_manifest_invalid');
      return true;
    });
    await assert.rejects(fixture.service.validate('../kuma-mieru.sqlite3'), error => {
      assert.equal(backupErrorCode(error), 'backup_id_invalid');
      return true;
    });

    const third = await fixture.service.create('owner_fixture');
    const thirdPath = resolve(fixture.dataDirectory, 'backups', `${third.backupId}.sqlite3`);
    await rm(thirdPath);
    await symlink(fixture.databasePath, thirdPath);
    await assert.rejects(fixture.service.validate(third.backupId), error => {
      assert.equal(backupErrorCode(error), 'backup_artifact_unsafe');
      return true;
    });
  } finally {
    fixture.database.close();
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('records insufficient-space failures without leaving partial artifacts', async () => {
  const fixture = await createFixture({ availableBytes: async () => 0 });
  try {
    await assert.rejects(fixture.service.create('owner_fixture'), error => {
      assert.equal(backupErrorCode(error), 'backup_space_insufficient');
      return true;
    });
    const [artifact] = fixture.service.list();
    assert.equal(artifact?.state, 'failed');
    assert.equal(artifact?.errorCode, 'backup_space_insufficient');
    assert.deepEqual(
      (await readdir(resolve(fixture.dataDirectory, 'backups'))).filter(name =>
        name.includes('.partial')
      ),
      []
    );
  } finally {
    fixture.database.close();
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('rejects a backup whose migration ledger is newer than this build', async () => {
  const fixture = await createFixture();
  try {
    const backup = await fixture.service.create('owner_fixture');
    const backupDirectory = resolve(fixture.dataDirectory, 'backups');
    const backupPath = resolve(backupDirectory, `${backup.backupId}.sqlite3`);
    const manifestPath = resolve(backupDirectory, `${backup.backupId}.manifest.json`);
    const candidate = new BetterSqlite3(backupPath);
    let futureVersion = 0;
    try {
      const currentVersion = (
        candidate.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
          version: number;
        }
      ).version;
      futureVersion = currentVersion + 1;
      candidate
        .prepare(
          `INSERT INTO schema_migrations
            (version, name, checksum_sha256, applied_at, app_build, execution_ms)
           VALUES (?, 'future', ?, ?, 'future', 0)`
        )
        .run(futureVersion, 'f'.repeat(64), new Date().toISOString());
      candidate.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      candidate.close();
    }
    const bytes = await readFile(backupPath);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.schemaVersion = futureVersion;
    manifest.sizeBytes = bytes.length;
    manifest.sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(fixture.service.validate(backup.backupId), error => {
      assert.equal(backupErrorCode(error), 'backup_schema_unsupported');
      return true;
    });
  } finally {
    fixture.database.close();
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('serializes concurrent backups and reconciles interrupted rows', async () => {
  let databaseForBackup: Database.Database | undefined;
  let releaseBackup: (() => void) | undefined;
  let signalStarted: (() => void) | undefined;
  const started = new Promise<void>(resolveStarted => {
    signalStarted = resolveStarted;
  });
  const release = new Promise<void>(resolveRelease => {
    releaseBackup = resolveRelease;
  });
  const fixture = await createFixture({
    backupDatabase: async targetPath => {
      signalStarted?.();
      await release;
      await databaseForBackup?.backup(targetPath);
    },
  });
  databaseForBackup = fixture.database;
  try {
    const first = fixture.service.create('owner_fixture');
    await started;
    await assert.rejects(fixture.service.create('owner_fixture'), error => {
      assert.equal(backupErrorCode(error), 'backup_in_progress');
      return true;
    });
    releaseBackup?.();
    await first;

    const interruptedId = 'bkp_00000000-0000-0000-0000-000000000000';
    fixture.database
      .prepare(
        `INSERT INTO backup_artifacts
          (id, state, file_name, created_by, created_at)
         VALUES (?, 'creating', ?, 'system:test', ?)`
      )
      .run(interruptedId, `${interruptedId}.sqlite3`, new Date().toISOString());
    const partial = resolve(fixture.dataDirectory, 'backups', `${interruptedId}.sqlite3.partial`);
    await writeFile(partial, 'partial');
    assert.equal(await fixture.service.recoverInterrupted(), 1);
    assert.equal((await lstat(partial).catch(() => null)) === null, true);
    assert.equal(
      fixture.service.list().find(item => item.id === interruptedId)?.errorCode,
      'backup_interrupted'
    );
  } finally {
    releaseBackup?.();
    fixture.database.close();
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('deletes only an eligible backup bound to its manifest hash and keeps an audit record', async () => {
  const fixture = await createFixture();
  try {
    const backup = await fixture.service.create('owner_fixture');
    const artifact = fixture.service.list().find(item => item.id === backup.backupId);
    assert.ok(artifact?.manifestSha256);
    await assert.rejects(
      fixture.service.deleteEligible({
        backupId: backup.backupId,
        expectedManifestSha256: artifact.manifestSha256,
        deletedBy: 'owner_fixture',
      }),
      error => backupErrorCode(error) === 'backup_not_eligible'
    );
    fixture.database
      .prepare(
        `UPDATE backup_artifacts
         SET retention_state = 'eligible', retention_decided_at = ?
         WHERE id = ?`
      )
      .run(new Date().toISOString(), backup.backupId);
    await assert.rejects(
      fixture.service.deleteEligible({
        backupId: backup.backupId,
        expectedManifestSha256: '0'.repeat(64),
        deletedBy: 'owner_fixture',
      }),
      error => backupErrorCode(error) === 'backup_manifest_hash_mismatch'
    );

    const deleted = await fixture.service.deleteEligible({
      backupId: backup.backupId,
      expectedManifestSha256: artifact.manifestSha256,
      deletedBy: 'owner_fixture',
    });
    assert.equal(deleted.backupId, backup.backupId);
    const backupDirectory = resolve(fixture.dataDirectory, 'backups');
    assert.equal(
      await lstat(resolve(backupDirectory, `${backup.backupId}.sqlite3`)).catch(() => null),
      null
    );
    assert.equal(
      await lstat(resolve(backupDirectory, `${backup.backupId}.manifest.json`)).catch(() => null),
      null
    );
    assert.equal(
      await lstat(resolve(backupDirectory, `${backup.backupId}.sqlite3.deleting`)).catch(
        () => null
      ),
      null
    );
    const listed = fixture.service.list().find(item => item.id === backup.backupId);
    assert.equal(listed?.deletionState, 'completed');
    assert.equal(listed?.deletedAt, deleted.deletedAt);
    assert.deepEqual(
      fixture.database
        .prepare(
          `SELECT state, manifest_sha256, artifact_sha256, deleted_by, completed_at
           FROM backup_deletions WHERE backup_id = ?`
        )
        .get(backup.backupId),
      {
        state: 'completed',
        manifest_sha256: artifact.manifestSha256,
        artifact_sha256: artifact.manifest?.sha256,
        deleted_by: 'owner_fixture',
        completed_at: deleted.deletedAt,
      }
    );
    await assert.rejects(
      fixture.service.validate(backup.backupId),
      error => backupErrorCode(error) === 'backup_deleted'
    );
  } finally {
    fixture.database.close();
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('rolls back a staged artifact rename when deletion fails before commit', async () => {
  let renameCalls = 0;
  const fixture = await createFixture({
    renameArtifact: async (source, destination) => {
      renameCalls += 1;
      if (renameCalls === 2) throw new Error('injected manifest rename failure');
      await rename(source, destination);
    },
  });
  try {
    const backup = await fixture.service.create('owner_fixture');
    const artifact = fixture.service.list().find(item => item.id === backup.backupId);
    assert.ok(artifact?.manifestSha256);
    fixture.database
      .prepare(
        `UPDATE backup_artifacts
         SET retention_state = 'eligible', retention_decided_at = ?
         WHERE id = ?`
      )
      .run(new Date().toISOString(), backup.backupId);

    await assert.rejects(
      fixture.service.deleteEligible({
        backupId: backup.backupId,
        expectedManifestSha256: artifact.manifestSha256,
        deletedBy: 'owner_fixture',
      }),
      /injected manifest rename failure/u
    );

    const backupDirectory = resolve(fixture.dataDirectory, 'backups');
    const backupPath = resolve(backupDirectory, `${backup.backupId}.sqlite3`);
    const manifestPath = resolve(backupDirectory, `${backup.backupId}.manifest.json`);
    assert.ok(await lstat(backupPath));
    assert.ok(await lstat(manifestPath));
    assert.equal(await lstat(`${backupPath}.deleting`).catch(() => null), null);
    assert.equal(await lstat(`${manifestPath}.deleting`).catch(() => null), null);
    assert.equal(
      fixture.database
        .prepare('SELECT state FROM backup_deletions WHERE backup_id = ?')
        .get(backup.backupId),
      undefined
    );
    assert.equal((await fixture.service.validate(backup.backupId)).backupId, backup.backupId);
  } finally {
    fixture.database.close();
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('recovers staging deletion by rollback and staged deletion by completion', async () => {
  const fixture = await createFixture();
  try {
    const first = await fixture.service.create('owner_fixture');
    const firstArtifact = fixture.service.list().find(item => item.id === first.backupId);
    assert.ok(firstArtifact?.manifestSha256);
    const backupDirectory = resolve(fixture.dataDirectory, 'backups');
    const firstPath = resolve(backupDirectory, `${first.backupId}.sqlite3`);
    const firstManifestPath = resolve(backupDirectory, `${first.backupId}.manifest.json`);
    fixture.database
      .prepare(
        `INSERT INTO backup_deletions
          (backup_id, state, manifest_sha256, artifact_sha256, deleted_by, requested_at)
         VALUES (?, 'staging', ?, ?, 'owner_fixture', ?)`
      )
      .run(
        first.backupId,
        firstArtifact.manifestSha256,
        firstArtifact.manifest?.sha256,
        new Date().toISOString()
      );
    await rename(firstPath, `${firstPath}.deleting`);
    assert.equal(await fixture.service.recoverInterrupted(), 1);
    assert.ok(await lstat(firstPath));
    assert.ok(await lstat(firstManifestPath));
    assert.equal(
      fixture.database
        .prepare('SELECT state FROM backup_deletions WHERE backup_id = ?')
        .get(first.backupId),
      undefined
    );

    const second = await fixture.service.create('owner_fixture');
    const secondArtifact = fixture.service.list().find(item => item.id === second.backupId);
    assert.ok(secondArtifact?.manifestSha256);
    const secondPath = resolve(backupDirectory, `${second.backupId}.sqlite3`);
    const secondManifestPath = resolve(backupDirectory, `${second.backupId}.manifest.json`);
    fixture.database
      .prepare(
        `INSERT INTO backup_deletions
          (backup_id, state, manifest_sha256, artifact_sha256, deleted_by, requested_at)
         VALUES (?, 'staged', ?, ?, 'owner_fixture', ?)`
      )
      .run(
        second.backupId,
        secondArtifact.manifestSha256,
        secondArtifact.manifest?.sha256,
        new Date().toISOString()
      );
    await rename(secondPath, `${secondPath}.deleting`);
    await rename(secondManifestPath, `${secondManifestPath}.deleting`);
    assert.equal(await fixture.service.recoverInterrupted(), 1);
    assert.equal(await lstat(`${secondPath}.deleting`).catch(() => null), null);
    assert.equal(await lstat(`${secondManifestPath}.deleting`).catch(() => null), null);
    assert.equal(
      (
        fixture.database
          .prepare('SELECT state FROM backup_deletions WHERE backup_id = ?')
          .get(second.backupId) as { state: string }
      ).state,
      'completed'
    );
  } finally {
    fixture.database.close();
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('scheduled backup only creates an artifact when the latest is older than one day', async () => {
  const fixture = await createFixture();
  try {
    assert.equal(
      await runBackupScheduleOnce({
        service: fixture.service,
        now: () => new Date('2026-07-25T00:00:00.000Z'),
      }),
      'created'
    );
    assert.equal(
      await runBackupScheduleOnce({
        service: fixture.service,
        now: () => new Date('2026-07-25T12:00:00.000Z'),
      }),
      'current'
    );
    assert.equal(fixture.service.list().length, 1);
  } finally {
    fixture.database.close();
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('does not treat a schema-upgrade artifact as the daily runtime backup', async () => {
  let creates = 0;
  const completedAt = '2026-07-25T11:00:00.000Z';
  const service = {
    list: () => [
      {
        id: 'bkp_00000000-0000-4000-8000-000000000001',
        state: 'ready' as const,
        fileName: 'bkp_00000000-0000-4000-8000-000000000001.sqlite3',
        manifest: {
          formatVersion: 1 as const,
          backupId: 'bkp_00000000-0000-4000-8000-000000000001',
          createdAt: completedAt,
          appBuild: 'test',
          schemaVersion: 12,
          fileName: 'bkp_00000000-0000-4000-8000-000000000001.sqlite3',
          sizeBytes: 4096,
          sha256: 'a'.repeat(64),
          purpose: 'schema-upgrade' as const,
          targetSchemaVersion: 13,
          migrationChecksums: [
            {
              version: 13,
              name: 'fixture',
              checksumSha256: 'b'.repeat(64),
            },
          ],
        },
        createdBy: 'system:schema-migration',
        createdAt: completedAt,
        completedAt,
        errorCode: null,
        retentionState: 'current' as const,
        retentionDecidedAt: null,
        manifestSha256: 'd'.repeat(64),
        deletionState: null,
        deletedAt: null,
      },
    ],
    create: async () => {
      creates += 1;
      return {
        backupId: 'bkp_00000000-0000-4000-8000-000000000002',
        valid: true as const,
        schemaVersion: 13,
        sizeBytes: 4096,
        sha256: 'c'.repeat(64),
        createdAt: '2026-07-25T12:00:00.000Z',
      };
    },
    validate: async () => {
      throw new Error('not used');
    },
    deleteEligible: async () => {
      throw new Error('not used');
    },
    recoverInterrupted: async () => 0,
  };
  assert.equal(
    await runBackupScheduleOnce({
      service,
      now: () => new Date('2026-07-25T12:00:00.000Z'),
    }),
    'created'
  );
  assert.equal(creates, 1);
});

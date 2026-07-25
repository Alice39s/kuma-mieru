import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import { validateBackupArtifact } from './backup.js';
import { openDatabase } from './database.js';
import { migrateDatabase } from './migrator.js';

const sourceMigration = resolve(process.cwd(), 'migrations', '000001_foundation.up.sql');

const createFixture = async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-migration-'));
  const sql = await readFile(sourceMigration, 'utf8');
  await writeFile(resolve(directory, '000001_foundation.up.sql'), sql);
  return directory;
};

test('applies migrations once and records the checksum ledger', async () => {
  const directory = await createFixture();
  const { database } = openDatabase(':memory:');
  try {
    const first = await migrateDatabase(database, { directory, appBuild: 'test' });
    const second = await migrateDatabase(database, { directory, appBuild: 'test' });
    assert.deepEqual(first.applied, [1]);
    assert.deepEqual(second.applied, []);
    assert.equal(first.currentVersion, 1);
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
          count: number;
        }
      ).count,
      1
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a modified migration that was already applied', async () => {
  const directory = await createFixture();
  const { database } = openDatabase(':memory:');
  try {
    await migrateDatabase(database, { directory, appBuild: 'test' });
    const path = resolve(directory, '000001_foundation.up.sql');
    await writeFile(path, `${await readFile(path, 'utf8')}\n-- drift\n`);
    await assert.rejects(
      migrateDatabase(database, { directory, appBuild: 'test' }),
      /Migration drift detected/u
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects migration files whose names do not match the ledger convention', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-migration-'));
  const { database } = openDatabase(':memory:');
  try {
    await writeFile(resolve(directory, '1_bad.up.sql'), 'SELECT 1;');
    await assert.rejects(
      migrateDatabase(database, { directory, appBuild: 'test' }),
      /Invalid migration filename/u
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('creates a private verified restore-compatible artifact before a schema upgrade', async () => {
  const directory = await createFixture();
  const dataDirectory = resolve(directory, 'data');
  const databasePath = resolve(dataDirectory, 'kuma-mieru.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, { directory, databasePath, appBuild: 'test-v1' });
    database
      .prepare('INSERT INTO runtime_state (key, value, updated_at) VALUES (?, ?, ?)')
      .run('fixture', 'before-upgrade', new Date().toISOString());
    await writeFile(
      resolve(directory, '000002_upgrade_fixture.up.sql'),
      'CREATE TABLE migration_two_fixture (id INTEGER PRIMARY KEY);\n'
    );
    const result = await migrateDatabase(database, {
      directory,
      databasePath,
      appBuild: 'test-v2',
    });
    assert.deepEqual(result.applied, [2]);
    assert.ok(result.backupArtifactId);
    assert.ok(result.backupPath);
    assert.ok(result.backupManifestPath);
    assert.equal((await stat(resolve(dataDirectory, 'backups'))).mode & 0o777, 0o700);
    assert.equal((await stat(result.backupPath)).mode & 0o777, 0o600);
    assert.equal((await stat(result.backupManifestPath)).mode & 0o777, 0o600);

    const manifest = JSON.parse(await readFile(result.backupManifestPath, 'utf8')) as {
      backupId: string;
      purpose: string;
      schemaVersion: number;
      targetSchemaVersion: number;
      migrationChecksums: Array<{ version: number; checksumSha256: string }>;
    };
    assert.equal(manifest.backupId, result.backupArtifactId);
    assert.equal(manifest.purpose, 'schema-upgrade');
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.targetSchemaVersion, 2);
    assert.equal(manifest.migrationChecksums[0]?.version, 2);
    assert.match(manifest.migrationChecksums[0]?.checksumSha256 ?? '', /^[0-9a-f]{64}$/u);
    const validation = await validateBackupArtifact({
      backupId: result.backupArtifactId,
      dataDirectory,
      migrationDirectory: directory,
    });
    assert.equal(validation.schemaVersion, 1);

    const snapshot = new BetterSqlite3(result.backupPath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      const row = snapshot
        .prepare("SELECT value FROM runtime_state WHERE key = 'fixture'")
        .get() as {
        value: string;
      };
      assert.equal(row.value, 'before-upgrade');
      assert.equal(
        (
          snapshot
            .prepare(
              "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'migration_two_fixture'"
            )
            .get() as { count: number }
        ).count,
        0
      );
    } finally {
      snapshot.close();
    }
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not advance the ledger when migration backup space or validation fails', async () => {
  for (const mode of ['space', 'write-space', 'corrupt'] as const) {
    const directory = await createFixture();
    const dataDirectory = resolve(directory, `data-${mode}`);
    const databasePath = resolve(dataDirectory, 'kuma-mieru.sqlite3');
    const { database } = openDatabase(databasePath);
    try {
      await migrateDatabase(database, { directory, databasePath, appBuild: 'test-v1' });
      await writeFile(
        resolve(directory, '000002_upgrade_fixture.up.sql'),
        'CREATE TABLE migration_two_fixture (id INTEGER PRIMARY KEY);\n'
      );
      await assert.rejects(
        migrateDatabase(database, {
          directory,
          databasePath,
          appBuild: 'test-v2',
          ...(mode === 'space'
            ? { availableBytes: async () => 0 }
            : mode === 'write-space'
              ? {
                  backupDatabase: async () => {
                    throw Object.assign(new Error('simulated disk exhaustion'), {
                      code: 'ENOSPC',
                    });
                  },
                }
              : {
                  backupDatabase: async (targetPath: string) => {
                    await writeFile(targetPath, 'not a sqlite database');
                  },
                }),
        }),
        error => {
          const code =
            typeof error === 'object' && error && 'code' in error ? error.code : undefined;
          assert.equal(
            code,
            mode === 'space'
              ? 'migration_backup_space_insufficient'
              : mode === 'write-space'
                ? 'migration_backup_space_exhausted'
                : 'migration_backup_header_invalid'
          );
          return true;
        }
      );
      assert.equal(
        (
          database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
            version: number;
          }
        ).version,
        1
      );
      assert.equal(
        (
          database
            .prepare(
              "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'migration_two_fixture'"
            )
            .get() as { count: number }
        ).count,
        0
      );
      const backupEntries = await readdir(resolve(dataDirectory, 'backups'));
      assert.deepEqual(
        backupEntries.filter(entry => entry.endsWith('.partial')),
        []
      );
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('preserves a verified backup and rolls back a failed migration transaction', async () => {
  const directory = await createFixture();
  const dataDirectory = resolve(directory, 'data-failed-migration');
  const databasePath = resolve(dataDirectory, 'kuma-mieru.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, { directory, databasePath, appBuild: 'test-v1' });
    await writeFile(
      resolve(directory, '000002_upgrade_fixture.up.sql'),
      `CREATE TABLE migration_two_fixture (id INTEGER PRIMARY KEY);
       INSERT INTO table_that_does_not_exist VALUES (1);\n`
    );
    await assert.rejects(
      migrateDatabase(database, { directory, databasePath, appBuild: 'test-v2' }),
      /table_that_does_not_exist/u
    );
    assert.equal(
      (
        database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
          version: number;
        }
      ).version,
      1
    );
    assert.equal(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'migration_two_fixture'"
          )
          .get() as { count: number }
      ).count,
      0
    );
    const entries = await readdir(resolve(dataDirectory, 'backups'));
    assert.equal(entries.filter(entry => entry.endsWith('.sqlite3')).length, 1);
    assert.equal(entries.filter(entry => entry.endsWith('.manifest.json')).length, 1);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects unversioned application tables without modifying them', async () => {
  const directory = await createFixture();
  const databasePath = resolve(directory, 'unversioned.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    database.exec('CREATE TABLE existing_application_data (id INTEGER PRIMARY KEY)');
    await assert.rejects(
      migrateDatabase(database, { directory, databasePath, appBuild: 'test' }),
      error =>
        Boolean(
          typeof error === 'object' &&
          error &&
          'code' in error &&
          error.code === 'migration_ledger_missing'
        )
    );
    assert.equal(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
          )
          .get() as { count: number }
      ).count,
      0
    );
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM existing_application_data').get() as {
          count: number;
        }
      ).count,
      0
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('registers a schema-upgrade artifact in an existing backup catalog', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-migration-catalog-'));
  const directory = resolve(root, 'migrations');
  const dataDirectory = resolve(root, 'data');
  const databasePath = resolve(dataDirectory, 'kuma-mieru.sqlite3');
  await cp(resolve(process.cwd(), 'migrations'), directory, { recursive: true });
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, { directory, databasePath, appBuild: 'test-v13' });
    await writeFile(
      resolve(directory, '000014_catalog_fixture.up.sql'),
      'CREATE TABLE migration_catalog_fixture (id INTEGER PRIMARY KEY);\n'
    );
    const result = await migrateDatabase(database, {
      directory,
      databasePath,
      appBuild: 'test-v14',
    });
    const artifact = database
      .prepare(
        `SELECT state, file_name, manifest_json, created_by
         FROM backup_artifacts WHERE id = ?`
      )
      .get(result.backupArtifactId) as {
      state: string;
      file_name: string;
      manifest_json: string;
      created_by: string;
    };
    assert.equal(artifact.state, 'ready');
    assert.equal(artifact.file_name, `${result.backupArtifactId}.sqlite3`);
    assert.equal(artifact.created_by, 'system:schema-migration');
    assert.equal(JSON.parse(artifact.manifest_json).purpose, 'schema-upgrade');
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('upgrades every historical schema to latest with a restorable backup and identical schema', async () => {
  const migrationDirectory = resolve(process.cwd(), 'migrations');
  const migrationFiles = (await readdir(migrationDirectory))
    .filter(fileName => fileName.endsWith('.up.sql'))
    .sort();
  const latestVersion = migrationFiles.length;
  const latestDatabase = openDatabase(':memory:');
  try {
    await migrateDatabase(latestDatabase.database, {
      directory: migrationDirectory,
      appBuild: 'matrix-latest',
    });
    const expectedSchema = latestDatabase.database
      .prepare(
        `SELECT type, name, tbl_name, sql
         FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%'
         ORDER BY type, name`
      )
      .all();

    for (let sourceVersion = 1; sourceVersion <= latestVersion; sourceVersion += 1) {
      const root = await mkdtemp(resolve(tmpdir(), `kuma-mieru-upgrade-v${sourceVersion}-`));
      const sourceMigrations = resolve(root, 'source-migrations');
      const dataDirectory = resolve(root, 'data');
      const databasePath = resolve(dataDirectory, 'kuma-mieru.sqlite3');
      await cp(migrationDirectory, sourceMigrations, {
        recursive: true,
        filter: source =>
          source === migrationDirectory ||
          migrationFiles
            .slice(0, sourceVersion)
            .some(fileName => source === resolve(migrationDirectory, fileName)),
      });
      const opened = openDatabase(databasePath);
      try {
        const source = await migrateDatabase(opened.database, {
          directory: sourceMigrations,
          databasePath,
          appBuild: `matrix-v${sourceVersion}`,
        });
        assert.equal(source.currentVersion, sourceVersion);
        opened.database
          .prepare(
            `INSERT INTO runtime_state (key, value, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
          )
          .run('upgrade-matrix-sentinel', `from-v${sourceVersion}`, new Date().toISOString());

        const upgraded = await migrateDatabase(opened.database, {
          directory: migrationDirectory,
          databasePath,
          appBuild: 'matrix-latest',
        });
        assert.equal(upgraded.currentVersion, latestVersion);
        assert.deepEqual(
          upgraded.applied,
          Array.from(
            { length: latestVersion - sourceVersion },
            (_value, index) => sourceVersion + index + 1
          )
        );
        assert.equal(
          (
            opened.database
              .prepare("SELECT value FROM runtime_state WHERE key = 'upgrade-matrix-sentinel'")
              .get() as { value: string }
          ).value,
          `from-v${sourceVersion}`
        );
        assert.deepEqual(
          opened.database
            .prepare(
              `SELECT type, name, tbl_name, sql
               FROM sqlite_master
               WHERE name NOT LIKE 'sqlite_%'
               ORDER BY type, name`
            )
            .all(),
          expectedSchema
        );

        if (sourceVersion === latestVersion) {
          assert.equal(upgraded.backupArtifactId, null);
        } else {
          assert.ok(upgraded.backupArtifactId);
          const backup = await validateBackupArtifact({
            backupId: upgraded.backupArtifactId,
            dataDirectory,
            migrationDirectory,
          });
          assert.equal(backup.schemaVersion, sourceVersion);
        }

        const repeated = await migrateDatabase(opened.database, {
          directory: migrationDirectory,
          databasePath,
          appBuild: 'matrix-latest',
        });
        assert.deepEqual(repeated.applied, []);
        assert.equal(repeated.backupArtifactId, null);
      } finally {
        opened.database.close();
        await rm(root, { recursive: true, force: true });
      }
    }
  } finally {
    latestDatabase.database.close();
  }
});

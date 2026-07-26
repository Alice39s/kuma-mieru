import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';
import { legacyEnvironmentKeys } from '../config/legacy-compatibility.js';
import { loadRuntimeConfig } from '../config/runtime-config.js';
import { openDatabase } from '../db/database.js';
import { acquireRuntimeLock } from '../db/runtime-lock.js';

const cleanEnvironment = () => {
  const legacy = new Set<string>(legacyEnvironmentKeys);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !legacy.has(key)));
};

test('migrate-v1 dry-run writes nothing and execute creates a reversible managed revision', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-v1-migration-'));
  const dataDirectory = resolve(directory, 'data');
  const cliPath = resolve(import.meta.dirname, 'migrate-v1.js');
  const environment = {
    ...cleanEnvironment(),
    KUMA_MIERU_DATA_DIR: dataDirectory,
    KUMA_MIERU_MIGRATIONS_DIR: resolve(process.cwd(), 'migrations'),
    KUMA_MIERU_V1_GENERATED_CONFIG: resolve(directory, 'missing-generated-config.json'),
    UPTIME_KUMA_URLS: 'https://status.example.com/status/main',
    KUMA_MIERU_TITLE: 'Migrated status',
  };
  try {
    const dryRun = spawnSync(process.execPath, [cliPath, '--dry-run'], {
      cwd: directory,
      env: environment,
      encoding: 'utf8',
    });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const dryRunResult = JSON.parse(dryRun.stdout) as {
      action: string;
      writesPerformed: boolean;
      targetMode: string;
      targetRevision: number;
    };
    assert.deepEqual(dryRunResult, {
      ...dryRunResult,
      action: 'dry-run',
      writesPerformed: false,
      targetMode: 'managed',
      targetRevision: 1,
    });
    assert.equal(existsSync(dataDirectory), false);

    const heldLock = await acquireRuntimeLock({ dataDirectory, appBuild: 'test-holder' });
    try {
      const blockedExecution = spawnSync(process.execPath, [cliPath, '--execute'], {
        cwd: directory,
        env: environment,
        encoding: 'utf8',
      });
      assert.notEqual(blockedExecution.status, 0);
      assert.match(blockedExecution.stderr, /Another Kuma Mieru runtime owns/u);
    } finally {
      heldLock.release();
    }

    const execution = spawnSync(process.execPath, [cliPath, '--execute'], {
      cwd: directory,
      env: environment,
      encoding: 'utf8',
    });
    assert.equal(execution.status, 0, execution.stderr);
    const executionResult = JSON.parse(execution.stdout) as {
      action: string;
      targetMode: string;
      importedRevision: number;
      backupDirectory: string;
      sqliteBackupPath: string;
      manifestPath: string;
    };
    assert.equal(executionResult.action, 'execute');
    assert.equal(executionResult.targetMode, 'managed');
    assert.equal(executionResult.importedRevision, 1);
    assert.equal(existsSync(executionResult.sqliteBackupPath), true);
    assert.equal(existsSync(executionResult.manifestPath), true);
    assert.equal((await readdir(resolve(dataDirectory, 'migration-backups'))).length, 1);

    const database = new Database(resolve(dataDirectory, 'kuma-mieru.sqlite3'), { readonly: true });
    try {
      const row = database
        .prepare(
          `SELECT c.config_json
           FROM runtime_state s JOIN config_revisions c ON c.revision = CAST(s.value AS INTEGER)
           WHERE s.key = 'active_config_revision'`
        )
        .get() as { config_json: string };
      assert.equal(JSON.parse(row.config_json).pages[0].title, 'Migrated status');
      assert.equal(
        (
          database
            .prepare("SELECT value FROM runtime_state WHERE key = 'active_config_mode'")
            .get() as { value: string }
        ).value,
        'managed'
      );
      assert.equal(
        (
          database
            .prepare(
              "SELECT COUNT(*) AS count FROM config_transitions WHERE from_mode = 'compatibility' AND to_mode = 'managed' AND state = 'completed'"
            )
            .get() as { count: number }
        ).count,
        1
      );
    } finally {
      database.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('migrate-v1 atomically exports a private file target and boots from its durable LKG', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-v1-file-migration-'));
  const dataDirectory = resolve(directory, 'data');
  const fileDirectory = resolve(directory, 'gitops');
  const filePath = resolve(fileDirectory, 'config.yml');
  const cliPath = resolve(import.meta.dirname, 'migrate-v1.js');
  await mkdir(fileDirectory, { mode: 0o700 });
  const environment = {
    ...cleanEnvironment(),
    KUMA_MIERU_CONFIG: filePath,
    KUMA_MIERU_DATA_DIR: dataDirectory,
    KUMA_MIERU_MIGRATIONS_DIR: resolve(process.cwd(), 'migrations'),
    KUMA_MIERU_V1_GENERATED_CONFIG: resolve(directory, 'missing-generated-config.json'),
    UPTIME_KUMA_URLS: 'https://status.example.com/status/main',
    KUMA_MIERU_TITLE: 'File migrated status',
  };
  try {
    const dryRun = spawnSync(process.execPath, [cliPath, '--dry-run', '--target=file'], {
      cwd: directory,
      env: environment,
      encoding: 'utf8',
    });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const dryRunResult = JSON.parse(dryRun.stdout) as {
      action: string;
      writesPerformed: boolean;
      targetMode: string;
      fileTargetPath: string;
      managedBaseRevision: number;
      targetRevision: number;
    };
    assert.equal(dryRunResult.action, 'dry-run');
    assert.equal(dryRunResult.writesPerformed, false);
    assert.equal(dryRunResult.targetMode, 'file');
    assert.equal(dryRunResult.fileTargetPath, filePath);
    assert.equal(dryRunResult.managedBaseRevision, 1);
    assert.equal(dryRunResult.targetRevision, 2);
    assert.equal(existsSync(filePath), false);
    assert.equal(existsSync(dataDirectory), false);

    const execution = spawnSync(process.execPath, [cliPath, '--execute', '--target', 'file'], {
      cwd: directory,
      env: environment,
      encoding: 'utf8',
    });
    assert.equal(execution.status, 0, execution.stderr);
    const executionResult = JSON.parse(execution.stdout) as {
      action: string;
      targetMode: string;
      importedRevision: number;
      managedBaseRevision: number;
      exportedConfigPath: string;
      exportedSourceHash: string;
      transitionId: string;
    };
    assert.equal(executionResult.action, 'execute');
    assert.equal(executionResult.targetMode, 'file');
    assert.equal(executionResult.importedRevision, 2);
    assert.equal(executionResult.managedBaseRevision, 1);
    assert.equal(executionResult.exportedConfigPath, filePath);
    assert.match(executionResult.exportedSourceHash, /^[0-9a-f]{64}$/u);
    assert.match(executionResult.transitionId, /^[0-9a-f-]{36}$/u);
    assert.equal((await stat(filePath)).mode & 0o777, 0o600);
    assert.match(await readFile(filePath, 'utf8'), /title: File migrated status/u);

    const blockedOverwrite = spawnSync(process.execPath, [cliPath, '--execute', '--target=file'], {
      cwd: directory,
      env: environment,
      encoding: 'utf8',
    });
    assert.notEqual(blockedOverwrite.status, 0);
    assert.match(blockedOverwrite.stderr, /never overwrites a file/u);

    const databasePath = resolve(dataDirectory, 'kuma-mieru.sqlite3');
    const readonly = new Database(databasePath, { readonly: true });
    try {
      assert.equal(
        (
          readonly.prepare('SELECT COUNT(*) AS count FROM config_revisions').get() as {
            count: number;
          }
        ).count,
        2
      );
      assert.equal(
        (
          readonly.prepare('SELECT COUNT(*) AS count FROM config_transitions').get() as {
            count: number;
          }
        ).count,
        1
      );
      const states = Object.fromEntries(
        (
          readonly
            .prepare(
              `SELECT key, value FROM runtime_state
               WHERE key IN (
                 'active_config_mode',
                 'active_config_revision',
                 'active_file_revision',
                 'active_file_path',
                 'active_file_source_hash',
                 'active_config_transition_id'
               )`
            )
            .all() as Array<{ key: string; value: string }>
        ).map(row => [row.key, row.value])
      );
      assert.equal(states.active_config_mode, 'file');
      assert.equal(states.active_config_revision, '1');
      assert.equal(states.active_file_revision, '2');
      assert.equal(states.active_file_path, filePath);
      assert.equal(states.active_file_source_hash, executionResult.exportedSourceHash);
      assert.equal(states.active_config_transition_id, executionResult.transitionId);
      const transition = readonly
        .prepare(
          `SELECT from_mode, to_mode, state, source_hash, target_hash, target_revision
           FROM config_transitions WHERE id = ?`
        )
        .get(executionResult.transitionId) as {
        from_mode: string;
        to_mode: string;
        state: string;
        source_hash: string;
        target_hash: string;
        target_revision: number;
      };
      assert.equal(transition.from_mode, 'compatibility');
      assert.equal(transition.to_mode, 'file');
      assert.equal(transition.state, 'completed');
      assert.equal(transition.source_hash, executionResult.exportedSourceHash);
      assert.match(transition.target_hash, /^[0-9a-f]{64}$/u);
      assert.equal(transition.target_revision, 2);
    } finally {
      readonly.close();
    }

    await writeFile(filePath, 'partial: true\n', { mode: 0o600 });
    const { database } = openDatabase(databasePath);
    try {
      const snapshot = await loadRuntimeConfig({ database, environment });
      assert.equal(snapshot.mode, 'file');
      assert.equal(snapshot.config.pages[0]?.title, 'File migrated status');
      assert.equal(snapshot.fileSourceHash, executionResult.exportedSourceHash);
    } finally {
      database.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

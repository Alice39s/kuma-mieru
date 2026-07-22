import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';
import { legacyEnvironmentKeys } from '../config/legacy-compatibility.js';

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
      targetRevision: number;
    };
    assert.deepEqual(dryRunResult, {
      ...dryRunResult,
      action: 'dry-run',
      writesPerformed: false,
      targetRevision: 1,
    });
    assert.equal(existsSync(dataDirectory), false);

    const execution = spawnSync(process.execPath, [cliPath, '--execute'], {
      cwd: directory,
      env: environment,
      encoding: 'utf8',
    });
    assert.equal(execution.status, 0, execution.stderr);
    const executionResult = JSON.parse(execution.stdout) as {
      action: string;
      importedRevision: number;
      backupDirectory: string;
      sqliteBackupPath: string;
      manifestPath: string;
    };
    assert.equal(executionResult.action, 'execute');
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
    } finally {
      database.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

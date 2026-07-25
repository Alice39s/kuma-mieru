import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildLegacyMigrationPlan } from '../config/legacy-compatibility.js';
import { createManagedRevision, getActiveRevision } from '../config/repository.js';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { acquireRuntimeLock } from '../db/runtime-lock.js';

const argumentsSet = new Set(process.argv.slice(2));
const execute = argumentsSet.has('--execute');
const dryRun = argumentsSet.has('--dry-run') || !execute;
if (execute && argumentsSet.has('--dry-run')) {
  throw new Error('Choose either --dry-run or --execute');
}
const unknownArguments = [...argumentsSet].filter(
  value => !['--dry-run', '--execute'].includes(value)
);
if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument: ${unknownArguments.join(', ')}`);
}

const currentDirectory = fileURLToPath(new URL('.', import.meta.url));
const dataDirectory = resolve(process.env.KUMA_MIERU_DATA_DIR ?? './data');
const databasePath = resolve(dataDirectory, 'kuma-mieru.sqlite3');
const generatedConfigPath = resolve(
  process.env.KUMA_MIERU_V1_GENERATED_CONFIG ?? './config/generated-config.json'
);
const bundledMigrationDirectory = resolve(currentDirectory, '../migrations');
const migrationDirectory = process.env.KUMA_MIERU_MIGRATIONS_DIR
  ? resolve(process.env.KUMA_MIERU_MIGRATIONS_DIR)
  : existsSync(bundledMigrationDirectory)
    ? bundledMigrationDirectory
    : resolve(process.cwd(), 'migrations');

const generatedConfig = existsSync(generatedConfigPath)
  ? JSON.parse(await readFile(generatedConfigPath, 'utf8'))
  : undefined;
const plan = buildLegacyMigrationPlan({ environment: process.env, generatedConfig });

const inspectTargetRevision = () => {
  if (!existsSync(databasePath)) return { parentRevision: null, targetRevision: 1 };
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const hasRevisionTable = database
      .prepare(
        `SELECT 1 AS found FROM sqlite_master
         WHERE type = 'table' AND name = 'config_revisions'`
      )
      .get() as { found: number } | undefined;
    if (!hasRevisionTable) return { parentRevision: null, targetRevision: 1 };
    const maximum = database
      .prepare('SELECT MAX(revision) AS revision FROM config_revisions')
      .get() as {
      revision: number | null;
    };
    const activeState = database
      .prepare("SELECT value FROM runtime_state WHERE key = 'active_config_revision'")
      .get() as { value: string } | undefined;
    return {
      parentRevision: activeState ? Number(activeState.value) : null,
      targetRevision: (maximum.revision ?? 0) + 1,
    };
  } finally {
    database.close();
  }
};

if (dryRun) {
  process.stdout.write(
    `${JSON.stringify(
      {
        action: 'dry-run',
        writesPerformed: false,
        source: plan.source,
        contentHash: plan.contentHash,
        ...inspectTargetRevision(),
        config: plan.config,
        conflicts: plan.conflicts,
        ignoredFields: plan.ignoredFields,
        decisions: plan.decisions,
        nextStep: 'Review this plan, back up the data directory, then run migrate-v1 --execute.',
      },
      null,
      2
    )}\n`
  );
} else {
  await mkdir(dataDirectory, { recursive: true });
  const runtimeLock = await acquireRuntimeLock({
    dataDirectory,
    appBuild: process.env.KUMA_MIERU_BUILD_VERSION ?? '2.0.0-dev',
  });
  try {
    const { database } = openDatabase(databasePath);
    try {
      const migration = await migrateDatabase(database, {
        directory: migrationDirectory,
        databasePath,
        appBuild: process.env.KUMA_MIERU_BUILD_VERSION ?? '2.0.0-dev',
      });
      const timestamp = new Date().toISOString().replaceAll(':', '-');
      const backupDirectory = resolve(dataDirectory, 'migration-backups', `v1-import-${timestamp}`);
      await mkdir(backupDirectory, { recursive: true });
      const sqliteBackupPath = resolve(backupDirectory, 'kuma-mieru.pre-import.sqlite3');
      await database.backup(sqliteBackupPath);
      let generatedConfigBackupPath: string | null = null;
      if (existsSync(generatedConfigPath)) {
        generatedConfigBackupPath = resolve(backupDirectory, 'generated-config.v1.json');
        await copyFile(generatedConfigPath, generatedConfigBackupPath);
      }
      const previous = getActiveRevision(database);
      const revision = createManagedRevision(database, plan.config, 'system:migrate-v1');
      const manifestPath = resolve(backupDirectory, 'migration-manifest.json');
      await writeFile(
        manifestPath,
        `${JSON.stringify(
          {
            source: plan.source,
            contentHash: plan.contentHash,
            previousRevision: previous?.revision ?? null,
            importedRevision: revision.revision,
            sqliteBackupPath,
            generatedConfigBackupPath,
            schemaBackupPath: migration.backupPath,
            conflicts: plan.conflicts,
            ignoredFields: plan.ignoredFields,
            decisions: plan.decisions,
          },
          null,
          2
        )}\n`
      );
      process.stdout.write(
        `${JSON.stringify(
          {
            action: 'execute',
            importedRevision: revision.revision,
            contentHash: revision.contentHash,
            backupDirectory,
            sqliteBackupPath,
            generatedConfigBackupPath,
            manifestPath,
            nextStep:
              'Set KUMA_MIERU_CONFIG_MODE=managed, restart, verify /health/ready, and retain the backup for rollback.',
          },
          null,
          2
        )}\n`
      );
    } finally {
      database.close();
    }
  } finally {
    runtimeLock.release();
  }
}

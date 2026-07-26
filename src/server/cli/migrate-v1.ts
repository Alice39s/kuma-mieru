import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { stringify } from 'yaml';
import { buildLegacyMigrationPlan } from '../config/legacy-compatibility.js';
import {
  getActiveRevision,
  getDurableConfigState,
  insertConfigRevision,
  setDurableConfigMode,
} from '../config/repository.js';
import { hashConfigSource } from '../config/runtime-config.js';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { acquireRuntimeLock } from '../db/runtime-lock.js';

const rawArguments = process.argv.slice(2);
const argumentsSet = new Set<string>();
let targetMode: 'managed' | 'file' = 'managed';
for (let index = 0; index < rawArguments.length; index += 1) {
  const argument = rawArguments[index] as string;
  if (argument === '--target') {
    const target = rawArguments[index + 1];
    if (!target) throw new Error('--target requires managed or file');
    if (target !== 'managed' && target !== 'file') {
      throw new Error('--target must be managed or file');
    }
    targetMode = target;
    index += 1;
  } else if (argument.startsWith('--target=')) {
    const target = argument.slice('--target='.length);
    if (target !== 'managed' && target !== 'file') {
      throw new Error('--target must be managed or file');
    }
    targetMode = target;
  } else {
    argumentsSet.add(argument);
  }
}
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
const fileTargetPath =
  targetMode === 'file' && process.env.KUMA_MIERU_CONFIG
    ? resolve(process.env.KUMA_MIERU_CONFIG)
    : null;
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

const syncDirectory = async (path: string) => {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const inspectFileTarget = async () => {
  if (!fileTargetPath) {
    throw new Error('KUMA_MIERU_CONFIG is required when --target=file');
  }
  if (fileTargetPath === databasePath || fileTargetPath === generatedConfigPath) {
    throw new Error('KUMA_MIERU_CONFIG must not replace the database or legacy generated config');
  }
  if (existsSync(fileTargetPath)) {
    throw new Error('KUMA_MIERU_CONFIG already exists; migrate-v1 never overwrites a file');
  }
  const parent = dirname(fileTargetPath);
  const metadata = await lstat(parent).catch(() => null);
  if (!metadata || !metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('KUMA_MIERU_CONFIG parent must be an existing real directory');
  }
  if ((await realpath(parent)) !== parent) {
    throw new Error('KUMA_MIERU_CONFIG parent must not traverse symbolic links');
  }
  return fileTargetPath;
};

const publishFileTarget = async (path: string, content: string) => {
  const parent = dirname(path);
  const partialPath = resolve(parent, `.${basename(path)}.migrate-v1-${randomUUID()}.partial`);
  let linked = false;
  try {
    const handle = await open(partialPath, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(partialPath, path);
    linked = true;
    await rm(partialPath);
    await syncDirectory(parent);
  } catch (error) {
    await rm(partialPath, { force: true }).catch(() => undefined);
    if (linked) {
      await rm(path, { force: true }).catch(() => undefined);
      await syncDirectory(parent).catch(() => undefined);
    }
    throw error;
  }
};

const selectedFileTarget = targetMode === 'file' ? await inspectFileTarget() : null;

const inspectTargetRevision = () => {
  if (!existsSync(databasePath)) {
    return {
      parentRevision: null,
      targetRevision: targetMode === 'file' ? 2 : 1,
      managedBaseRevision: targetMode === 'file' ? 1 : null,
    };
  }
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const hasRevisionTable = database
      .prepare(
        `SELECT 1 AS found FROM sqlite_master
         WHERE type = 'table' AND name = 'config_revisions'`
      )
      .get() as { found: number } | undefined;
    if (!hasRevisionTable) {
      return {
        parentRevision: null,
        targetRevision: targetMode === 'file' ? 2 : 1,
        managedBaseRevision: targetMode === 'file' ? 1 : null,
      };
    }
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
      targetRevision: (maximum.revision ?? 0) + (targetMode === 'file' ? 2 : 1),
      managedBaseRevision: targetMode === 'file' ? (maximum.revision ?? 0) + 1 : null,
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
        targetMode,
        fileTargetPath: selectedFileTarget,
        source: plan.source,
        contentHash: plan.contentHash,
        ...inspectTargetRevision(),
        config: plan.config,
        conflicts: plan.conflicts,
        ignoredFields: plan.ignoredFields,
        decisions: plan.decisions,
        nextStep:
          targetMode === 'file'
            ? 'Review this plan, then run migrate-v1 --execute --target=file to publish the fixed GitOps file and durable cutover.'
            : 'Review this plan, then run migrate-v1 --execute to create the backup and durable Managed cutover.',
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
      const executedAt = new Date().toISOString();
      const timestamp = executedAt.replaceAll(':', '-');
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
      const previousDurable = getDurableConfigState(database);
      const exportedConfig =
        targetMode === 'file' ? stringify(plan.config, { lineWidth: 0 }) : null;
      const exportedSourceHash = exportedConfig ? hashConfigSource(exportedConfig) : null;
      if (selectedFileTarget && exportedConfig) {
        await publishFileTarget(selectedFileTarget, exportedConfig);
      }
      let managedBaseRevision: number | null = null;
      const transitionId = randomUUID();
      let revision;
      try {
        revision = database.transaction(() => {
          const managedRevision = insertConfigRevision(database, {
            mode: 'managed',
            config: plan.config,
            parentRevision: previous?.revision ?? null,
            actor: 'system:migrate-v1',
            now: executedAt,
          });
          let activeRevision = managedRevision;
          if (targetMode === 'managed') {
            setDurableConfigMode(database, {
              mode: 'managed',
              managedRevision: managedRevision.revision,
              transitionId,
              now: executedAt,
            });
          } else {
            managedBaseRevision = managedRevision.revision;
            const fileRevision = insertConfigRevision(database, {
              mode: 'file',
              config: plan.config,
              parentRevision: previousDurable.fileRevision,
              actor: 'system:migrate-v1',
              now: executedAt,
            });
            setDurableConfigMode(database, {
              mode: 'file',
              managedRevision: managedRevision.revision,
              fileRevision: fileRevision.revision,
              filePath: selectedFileTarget,
              fileSourceHash: exportedSourceHash,
              transitionId,
              now: executedAt,
            });
            activeRevision = fileRevision;
          }
          database
            .prepare(
              `INSERT INTO config_transitions
                (id, from_mode, to_mode, source_hash, expected_revision, state, actor,
                 error_code, created_at, completed_at, source_kind, source_ref, target_hash,
                 target_revision, updated_at)
               VALUES (?, 'compatibility', ?, ?, ?, 'completed', 'system:migrate-v1',
                       NULL, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              transitionId,
              targetMode,
              exportedSourceHash ?? plan.contentHash,
              previous?.revision ?? null,
              executedAt,
              executedAt,
              targetMode,
              targetMode === 'file' ? selectedFileTarget : String(activeRevision.revision),
              activeRevision.contentHash,
              activeRevision.revision,
              executedAt
            );
          return activeRevision;
        })();
      } catch (error) {
        if (selectedFileTarget) {
          await rm(selectedFileTarget, { force: true });
          await syncDirectory(dirname(selectedFileTarget));
        }
        throw error;
      }
      const manifestPath = resolve(backupDirectory, 'migration-manifest.json');
      await writeFile(
        manifestPath,
        `${JSON.stringify(
          {
            source: plan.source,
            targetMode,
            contentHash: plan.contentHash,
            previousRevision: previous?.revision ?? null,
            importedRevision: revision.revision,
            managedBaseRevision,
            exportedConfigPath: selectedFileTarget,
            exportedSourceHash,
            transitionId,
            sqliteBackupPath,
            generatedConfigBackupPath,
            schemaBackupPath: migration.backupPath,
            schemaBackupManifestPath: migration.backupManifestPath,
            schemaBackupArtifactId: migration.backupArtifactId,
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
            targetMode,
            importedRevision: revision.revision,
            managedBaseRevision,
            contentHash: revision.contentHash,
            exportedConfigPath: selectedFileTarget,
            exportedSourceHash,
            transitionId,
            backupDirectory,
            sqliteBackupPath,
            generatedConfigBackupPath,
            manifestPath,
            schemaBackupArtifactId: migration.backupArtifactId,
            nextStep:
              targetMode === 'file'
                ? 'Restart, verify /health/ready reports file mode, and retain the migration backup for rollback.'
                : 'Restart, verify /health/ready reports managed mode, and retain the migration backup for rollback.',
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

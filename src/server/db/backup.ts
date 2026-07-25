import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import { z } from 'zod';
import { getActiveRevision } from '../config/repository.js';
import { resolveRetentionPolicy } from '../config/schema.js';
import { writePostRestoreRetentionMarker } from '../retention/restore-marker.js';
import { loadMigrationFiles, verifyAppliedMigrations, verifyDatabase } from './migrator.js';

const minimumFreeBytes = 16 * 1024 * 1024;
const maximumManifestBytes = 64 * 1024;
const sqliteHeader = Buffer.from('SQLite format 3\0', 'binary');
const backupIdSchema = z
  .string()
  .regex(/^bkp_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);

export const backupManifestSchema = z.object({
  formatVersion: z.literal(1),
  backupId: backupIdSchema,
  createdAt: z.iso.datetime(),
  appBuild: z.string().min(1).max(200),
  schemaVersion: z.number().int().nonnegative(),
  fileName: z
    .string()
    .regex(
      /^bkp_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.sqlite3$/u
    ),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  purpose: z.enum(['runtime-backup', 'schema-upgrade']).optional(),
  targetSchemaVersion: z.number().int().positive().optional(),
  migrationChecksums: z
    .array(
      z.object({
        version: z.number().int().positive(),
        name: z.string().min(1).max(200),
        checksumSha256: z.string().regex(/^[0-9a-f]{64}$/u),
      })
    )
    .optional(),
});

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export interface BackupArtifact {
  id: string;
  state: 'creating' | 'ready' | 'failed';
  fileName: string;
  manifest: BackupManifest | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
  retentionState: 'current' | 'eligible' | 'hold';
  retentionDecidedAt: string | null;
}

export interface BackupValidation {
  backupId: string;
  valid: true;
  schemaVersion: number;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface CreateBackupServiceOptions {
  database: Database.Database;
  databasePath: string;
  dataDirectory: string;
  migrationDirectory: string;
  appBuild: string;
  now?: () => Date;
  availableBytes?: (path: string) => Promise<number>;
  backupDatabase?: (targetPath: string) => Promise<void>;
}

export interface BackupService {
  create(createdBy: string): Promise<BackupValidation>;
  list(): BackupArtifact[];
  validate(backupId: string): Promise<BackupValidation>;
  recoverInterrupted(): Promise<number>;
}

const backupScheduleIntervalMs = 60 * 60 * 1000;
const backupScheduleMaximumAgeMs = 24 * 60 * 60 * 1000;

export const runBackupScheduleOnce = async ({
  service,
  now = () => new Date(),
}: {
  service: BackupService;
  now?: () => Date;
}) => {
  const latest = service
    .list()
    .find(
      artifact =>
        artifact.state === 'ready' &&
        artifact.completedAt !== null &&
        artifact.manifest?.purpose !== 'schema-upgrade'
    );
  if (
    latest?.completedAt &&
    now().getTime() - new Date(latest.completedAt).getTime() < backupScheduleMaximumAgeMs
  ) {
    return 'current' as const;
  }
  await service.create('system:backup-scheduler');
  return 'created' as const;
};

export const startBackupScheduler = ({
  service,
  onError = error => console.error('Scheduled backup failed', { code: backupErrorCode(error) }),
}: {
  service: BackupService;
  onError?: (error: unknown) => void;
}) => {
  const run = () => void runBackupScheduleOnce({ service }).catch(onError);
  const startupTimer = setTimeout(run, 60_000);
  const interval = setInterval(run, backupScheduleIntervalMs);
  startupTimer.unref();
  interval.unref();
  return () => {
    clearTimeout(startupTimer);
    clearInterval(interval);
  };
};

const codedError = (code: string, message: string) => Object.assign(new Error(message), { code });

export const backupErrorCode = (error: unknown) =>
  typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'backup_failed';

const hashFile = async (path: string) => {
  const file = await open(path, 'r');
  try {
    const hash = createHash('sha256');
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest('hex');
  } finally {
    await file.close();
  }
};

const fileSize = async (path: string) => {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (backupErrorCode(error) === 'ENOENT') return 0;
    throw error;
  }
};

const defaultAvailableBytes = async (path: string) => {
  const filesystem = await statfs(path, { bigint: true });
  return Number(filesystem.bavail * filesystem.bsize);
};

const syncPath = async (path: string) => {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const ensurePrivateDirectory = async (path: string) => {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw codedError('backup_directory_unsafe', 'Backup directory must be a real directory');
  }
  await chmod(path, 0o700);
};

const assertRegularFile = async (path: string, code: string) => {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (backupErrorCode(error) === 'ENOENT') {
      throw codedError(`${code}_missing`, 'Backup artifact is missing');
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw codedError(code, 'Backup artifact must be a regular file');
  }
  return metadata;
};

const inspectBackup = async ({
  backupId,
  backupPath,
  manifestPath,
  migrationDirectory,
}: {
  backupId: string;
  backupPath: string;
  manifestPath: string;
  migrationDirectory: string;
}): Promise<BackupValidation> => {
  backupIdSchema.parse(backupId);
  const manifestMetadata = await assertRegularFile(manifestPath, 'backup_manifest_unsafe');
  if (manifestMetadata.size > maximumManifestBytes) {
    throw codedError('backup_manifest_too_large', 'Backup manifest exceeds the size limit');
  }
  let manifest: BackupManifest;
  try {
    manifest = backupManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  } catch {
    throw codedError('backup_manifest_invalid', 'Backup manifest is invalid');
  }
  if (manifest.backupId !== backupId || manifest.fileName !== `${backupId}.sqlite3`) {
    throw codedError('backup_manifest_mismatch', 'Backup manifest does not match the artifact');
  }

  const backupMetadata = await assertRegularFile(backupPath, 'backup_artifact_unsafe');
  const file = await open(backupPath, 'r');
  try {
    const header = Buffer.alloc(sqliteHeader.length);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead !== header.length || !header.equals(sqliteHeader)) {
      throw codedError('backup_header_invalid', 'Backup does not have a SQLite header');
    }
  } finally {
    await file.close();
  }
  if (backupMetadata.size !== manifest.sizeBytes) {
    throw codedError('backup_size_mismatch', 'Backup size does not match its manifest');
  }
  const sha256 = await hashFile(backupPath);
  if (sha256 !== manifest.sha256) {
    throw codedError('backup_checksum_mismatch', 'Backup checksum does not match its manifest');
  }

  const candidate = new BetterSqlite3(backupPath, { readonly: true, fileMustExist: true });
  try {
    candidate.pragma('foreign_keys = ON');
    try {
      verifyDatabase(candidate);
    } catch {
      throw codedError('backup_integrity_failed', 'Backup SQLite integrity validation failed');
    }
    const files = await loadMigrationFiles(migrationDirectory);
    let applied;
    try {
      applied = verifyAppliedMigrations(candidate, files);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = message.includes('has no matching file')
        ? 'backup_schema_unsupported'
        : message.includes('drift')
          ? 'backup_migration_drift'
          : 'backup_migration_ledger_invalid';
      throw codedError(code, 'Backup migration ledger validation failed');
    }
    const schemaVersion = applied.at(-1)?.version ?? 0;
    if (schemaVersion !== manifest.schemaVersion) {
      throw codedError('backup_schema_mismatch', 'Backup schema does not match its manifest');
    }
  } finally {
    candidate.close();
  }

  return {
    backupId,
    valid: true,
    schemaVersion: manifest.schemaVersion,
    sizeBytes: manifest.sizeBytes,
    sha256,
    createdAt: manifest.createdAt,
  };
};

export const validateBackupArtifact = async ({
  backupId,
  dataDirectory,
  migrationDirectory,
}: {
  backupId: string;
  dataDirectory: string;
  migrationDirectory: string;
}) => {
  const parsedId = backupIdSchema.safeParse(backupId);
  if (!parsedId.success) throw codedError('backup_id_invalid', 'Backup ID is invalid');
  const backupDirectory = resolve(dataDirectory, 'backups');
  await ensurePrivateDirectory(backupDirectory);
  return inspectBackup({
    backupId,
    backupPath: resolve(backupDirectory, `${backupId}.sqlite3`),
    manifestPath: resolve(backupDirectory, `${backupId}.manifest.json`),
    migrationDirectory,
  });
};

export const restoreBackupArtifact = async ({
  backupId,
  dataDirectory,
  databasePath,
  migrationDirectory,
  now = () => new Date(),
  availableBytes = defaultAvailableBytes,
}: {
  backupId: string;
  dataDirectory: string;
  databasePath: string;
  migrationDirectory: string;
  now?: () => Date;
  availableBytes?: (path: string) => Promise<number>;
}) => {
  const validation = await validateBackupArtifact({
    backupId,
    dataDirectory,
    migrationDirectory,
  });
  for (const liveSidecar of [`${databasePath}-wal`, `${databasePath}-shm`]) {
    try {
      await lstat(liveSidecar);
      throw codedError(
        'restore_database_active',
        'Database WAL/SHM files exist; stop Kuma Mieru before restoring'
      );
    } catch (error) {
      if (backupErrorCode(error) !== 'ENOENT') throw error;
    }
  }
  const databaseDirectory = dirname(databasePath);
  const activeSize = await fileSize(databasePath);
  const activeRetentionPolicy =
    activeSize > 0
      ? (() => {
          const active = new BetterSqlite3(databasePath, {
            readonly: true,
            fileMustExist: true,
          });
          try {
            const revision = getActiveRevision(active);
            return revision
              ? resolveRetentionPolicy(revision.config.dataLifecycle?.retention)
              : undefined;
          } catch {
            return undefined;
          } finally {
            active.close();
          }
        })()
      : undefined;
  if ((await availableBytes(databaseDirectory)) < validation.sizeBytes + activeSize) {
    throw codedError('restore_space_insufficient', 'Insufficient space for restore rollback copy');
  }

  const backupPath = resolve(dataDirectory, 'backups', `${backupId}.sqlite3`);
  const partialPath = `${databasePath}.restore-partial`;
  const rollbackPath = `${databasePath}.pre-restore-${now().toISOString().replaceAll(':', '-')}`;
  if ((await lstat(rollbackPath).catch(() => null)) !== null) {
    throw codedError('restore_rollback_exists', 'Restore rollback destination already exists');
  }
  await rm(partialPath, { force: true });
  await copyFile(backupPath, partialPath);
  await chmod(partialPath, 0o600);
  await syncPath(partialPath);
  const copiedHash = await hashFile(partialPath);
  if (copiedHash !== validation.sha256) {
    await rm(partialPath, { force: true });
    throw codedError('restore_copy_mismatch', 'Restore copy checksum does not match the backup');
  }

  let activeMoved = false;
  let candidatePromoted = false;
  try {
    if (activeSize > 0) {
      await rename(databasePath, rollbackPath);
      activeMoved = true;
    }
    await rename(partialPath, databasePath);
    candidatePromoted = true;
    await syncPath(databaseDirectory);
    const restored = new BetterSqlite3(databasePath, { readonly: true, fileMustExist: true });
    try {
      restored.pragma('foreign_keys = ON');
      verifyDatabase(restored);
      const files = await loadMigrationFiles(migrationDirectory);
      verifyAppliedMigrations(restored, files);
    } finally {
      restored.close();
    }
    await writePostRestoreRetentionMarker(dataDirectory, {
      formatVersion: 1,
      backupId,
      restoredAt: now().toISOString(),
      retentionPolicy: activeRetentionPolicy,
    });
    return {
      ...validation,
      rollbackFileName: activeMoved ? basename(rollbackPath) : null,
    };
  } catch (error) {
    await rm(partialPath, { force: true });
    if (candidatePromoted) await rm(databasePath, { force: true });
    if (activeMoved) await rename(rollbackPath, databasePath);
    throw error;
  }
};

const mapArtifact = (row: {
  id: string;
  state: BackupArtifact['state'];
  file_name: string;
  manifest_json: string | null;
  created_by: string;
  created_at: string;
  completed_at: string | null;
  error_code: string | null;
  retention_state: BackupArtifact['retentionState'];
  retention_decided_at: string | null;
}): BackupArtifact => ({
  id: row.id,
  state: row.state,
  fileName: row.file_name,
  manifest: row.manifest_json ? backupManifestSchema.parse(JSON.parse(row.manifest_json)) : null,
  createdBy: row.created_by,
  createdAt: row.created_at,
  completedAt: row.completed_at,
  errorCode: row.error_code,
  retentionState: row.retention_state,
  retentionDecidedAt: row.retention_decided_at,
});

export const createBackupService = (options: CreateBackupServiceOptions): BackupService => {
  const backupDirectory = resolve(options.dataDirectory, 'backups');
  const now = options.now ?? (() => new Date());
  const availableBytes = options.availableBytes ?? defaultAvailableBytes;
  const backupDatabase =
    options.backupDatabase ??
    (async (targetPath: string) => {
      await options.database.backup(targetPath);
    });

  const list = () =>
    (
      options.database
        .prepare(
          `SELECT id, state, file_name, manifest_json, created_by, created_at, completed_at,
                  error_code, retention_state, retention_decided_at
           FROM backup_artifacts
           ORDER BY created_at DESC`
        )
        .all() as Array<Parameters<typeof mapArtifact>[0]>
    ).map(mapArtifact);

  const validate = async (backupId: string) => {
    const parsedId = backupIdSchema.safeParse(backupId);
    if (!parsedId.success) throw codedError('backup_id_invalid', 'Backup ID is invalid');
    const artifact = options.database
      .prepare('SELECT state FROM backup_artifacts WHERE id = ?')
      .get(backupId) as { state: BackupArtifact['state'] } | undefined;
    if (!artifact) throw codedError('backup_not_found', 'Backup was not found');
    if (artifact.state !== 'ready') throw codedError('backup_not_ready', 'Backup is not ready');
    return validateBackupArtifact({
      backupId,
      dataDirectory: options.dataDirectory,
      migrationDirectory: options.migrationDirectory,
    });
  };

  const recoverInterrupted = async () => {
    await ensurePrivateDirectory(backupDirectory);
    const interrupted = options.database
      .prepare("SELECT id FROM backup_artifacts WHERE state = 'creating'")
      .all() as Array<{ id: string }>;
    const completedAt = now().toISOString();
    const markFailed = options.database.prepare(
      `UPDATE backup_artifacts
       SET state = 'failed', completed_at = ?, error_code = 'backup_interrupted'
       WHERE id = ? AND state = 'creating'`
    );
    for (const { id } of interrupted) {
      await rm(resolve(backupDirectory, `${id}.sqlite3.partial`), { force: true });
      markFailed.run(completedAt, id);
    }
    return interrupted.length;
  };

  const create = async (createdBy: string) => {
    await ensurePrivateDirectory(backupDirectory);
    const backupId = `bkp_${randomUUID()}`;
    const fileName = `${backupId}.sqlite3`;
    const partialPath = resolve(backupDirectory, `${fileName}.partial`);
    const backupPath = resolve(backupDirectory, fileName);
    const manifestPath = resolve(backupDirectory, `${backupId}.manifest.json`);
    const manifestPartialPath = `${manifestPath}.partial`;
    const createdAt = now().toISOString();
    const reserve = options.database.transaction(() => {
      const active = options.database
        .prepare("SELECT id FROM backup_artifacts WHERE state = 'creating' LIMIT 1")
        .get();
      if (active) throw codedError('backup_in_progress', 'Another backup is already running');
      options.database
        .prepare(
          `INSERT INTO backup_artifacts
            (id, state, file_name, manifest_json, created_by, created_at)
           VALUES (?, 'creating', ?, NULL, ?, ?)`
        )
        .run(backupId, fileName, createdBy, createdAt);
    });
    reserve();

    try {
      const sourceBytes =
        (await fileSize(options.databasePath)) +
        (await fileSize(`${options.databasePath}-wal`)) +
        (await fileSize(`${options.databasePath}-shm`));
      const requiredBytes = Math.max(minimumFreeBytes, sourceBytes * 2);
      if ((await availableBytes(backupDirectory)) < requiredBytes) {
        throw codedError('backup_space_insufficient', 'Insufficient space for a consistent backup');
      }

      await backupDatabase(partialPath);
      await chmod(partialPath, 0o600);
      await syncPath(partialPath);
      const sizeBytes = (await assertRegularFile(partialPath, 'backup_artifact_unsafe')).size;
      const sha256 = await hashFile(partialPath);
      const applied = options.database
        .prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
        .get() as { version: number } | undefined;
      const manifest: BackupManifest = {
        formatVersion: 1,
        backupId,
        createdAt,
        appBuild: options.appBuild,
        schemaVersion: applied?.version ?? 0,
        fileName,
        sizeBytes,
        sha256,
        purpose: 'runtime-backup',
      };
      await writeFile(manifestPartialPath, `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await syncPath(manifestPartialPath);
      await rename(partialPath, backupPath);
      await rename(manifestPartialPath, manifestPath);
      await syncPath(backupDirectory);
      await inspectBackup({
        backupId,
        backupPath,
        manifestPath,
        migrationDirectory: options.migrationDirectory,
      });
      const completedAt = now().toISOString();
      options.database
        .prepare(
          `UPDATE backup_artifacts
           SET state = 'ready', manifest_json = ?, completed_at = ?, error_code = NULL
           WHERE id = ? AND state = 'creating'`
        )
        .run(JSON.stringify(manifest), completedAt, backupId);
      return {
        backupId,
        valid: true,
        schemaVersion: manifest.schemaVersion,
        sizeBytes,
        sha256,
        createdAt,
      } satisfies BackupValidation;
    } catch (error) {
      const errorCode = backupErrorCode(error);
      await rm(partialPath, { force: true });
      await rm(manifestPartialPath, { force: true });
      options.database
        .prepare(
          `UPDATE backup_artifacts
           SET state = 'failed', completed_at = ?, error_code = ?
           WHERE id = ? AND state = 'creating'`
        )
        .run(now().toISOString(), errorCode, backupId);
      throw error;
    }
  };

  return { create, list, validate, recoverInterrupted };
};

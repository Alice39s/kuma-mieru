import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';

export interface MigrationFile {
  version: number;
  name: string;
  path: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum_sha256: string;
}

export interface MigrationResult {
  applied: number[];
  currentVersion: number;
  backupPath: string | null;
  backupManifestPath: string | null;
  backupArtifactId: string | null;
}

export interface MigrationOptions {
  directory: string;
  databasePath?: string;
  appBuild?: string;
  now?: () => Date;
  availableBytes?: (path: string) => Promise<number>;
  backupDatabase?: (targetPath: string) => Promise<void>;
}

const migrationFileName = /^([0-9]{6})_([a-z0-9_]+)\.up\.sql$/;
const sqliteHeader = Buffer.from('SQLite format 3\0', 'binary');
const minimumBackupFreeBytes = 16 * 1024 * 1024;

const checksum = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');

export const loadMigrationFiles = async (directory: string): Promise<MigrationFile[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.up.sql'))
    .map(entry => entry.name)
    .sort();

  const invalidFile = candidates.find(fileName => !migrationFileName.test(fileName));
  if (invalidFile) {
    throw new Error(`Invalid migration filename: ${invalidFile}`);
  }

  const migrations = await Promise.all(
    candidates.map(async fileName => {
      const match = migrationFileName.exec(fileName);
      if (!match) {
        throw new Error(`Invalid migration filename: ${fileName}`);
      }
      const path = resolve(directory, fileName);
      const sql = await readFile(path, 'utf8');
      return {
        version: Number(match[1]),
        name: match[2],
        path,
        sql,
        checksum: checksum(sql),
      };
    })
  );

  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Migration sequence must be contiguous: expected ${expectedVersion}, got ${migration.version}`
      );
    }
  });

  return migrations;
};

const ensureLedger = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum_sha256 TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      app_build TEXT NOT NULL,
      execution_ms INTEGER NOT NULL
    )
  `);
};

export const verifyDatabase = (database: Database.Database) => {
  const integrity = database.pragma('integrity_check') as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
    throw new Error('SQLite integrity_check failed');
  }

  const foreignKeyErrors = database.pragma('foreign_key_check') as unknown[];
  if (foreignKeyErrors.length > 0) {
    throw new Error('SQLite foreign_key_check failed');
  }
};

const hasApplicationTables = (database: Database.Database) => {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT IN ('schema_migrations', 'sqlite_sequence')`
    )
    .get() as { count: number };
  return row.count > 0;
};

export const verifyAppliedMigrations = (
  database: Database.Database,
  files: MigrationFile[]
): AppliedMigration[] => {
  const appliedRows = database
    .prepare('SELECT version, name, checksum_sha256 FROM schema_migrations ORDER BY version ASC')
    .all() as AppliedMigration[];

  for (const [index, applied] of appliedRows.entries()) {
    if (applied.version !== index + 1) {
      throw new Error(`Applied migration ledger is not contiguous at version ${applied.version}`);
    }
    const file = files.find(candidate => candidate.version === applied.version);
    if (!file) {
      throw new Error(`Database migration ${applied.version} has no matching file`);
    }
    if (file.name !== applied.name || file.checksum !== applied.checksum_sha256) {
      throw new Error(`Migration drift detected at version ${applied.version}`);
    }
  }
  return appliedRows;
};

interface SchemaUpgradeBackup {
  artifactId: string;
  path: string;
  manifestPath: string;
  manifest: {
    formatVersion: 1;
    backupId: string;
    createdAt: string;
    appBuild: string;
    schemaVersion: number;
    fileName: string;
    sizeBytes: number;
    sha256: string;
    purpose: 'schema-upgrade';
    targetSchemaVersion: number;
    migrationChecksums: Array<{
      version: number;
      name: string;
      checksumSha256: string;
    }>;
  };
}

const migrationError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

const errorCode = (error: unknown) =>
  typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'migration_backup_failed';

const fileSize = async (path: string) => {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 0;
    throw error;
  }
};

const availableFilesystemBytes = async (path: string) => {
  const filesystem = await statfs(path, { bigint: true });
  return Number(filesystem.bavail * filesystem.bsize);
};

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

const syncPath = async (path: string) => {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const ensurePrivateBackupDirectory = async (path: string) => {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw migrationError(
      'migration_backup_directory_unsafe',
      'Migration backup directory must be a real directory'
    );
  }
  await chmod(path, 0o700);
};

const validateUpgradeSnapshot = async (
  path: string,
  files: MigrationFile[],
  expectedSchemaVersion: number
) => {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw migrationError(
      'migration_backup_artifact_unsafe',
      'Migration backup must be a regular file'
    );
  }
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(sqliteHeader.length);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead !== header.length || !header.equals(sqliteHeader)) {
      throw migrationError(
        'migration_backup_header_invalid',
        'Migration backup does not have a SQLite header'
      );
    }
  } finally {
    await file.close();
  }
  const candidate = new BetterSqlite3(path, { readonly: true, fileMustExist: true });
  try {
    candidate.pragma('foreign_keys = ON');
    try {
      verifyDatabase(candidate);
    } catch {
      throw migrationError(
        'migration_backup_integrity_failed',
        'Migration backup SQLite integrity validation failed'
      );
    }
    let applied;
    try {
      applied = verifyAppliedMigrations(candidate, files);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = message.includes('has no matching file')
        ? 'migration_backup_schema_unsupported'
        : message.includes('drift')
          ? 'migration_backup_ledger_drift'
          : 'migration_backup_ledger_invalid';
      throw migrationError(code, 'Migration backup ledger validation failed');
    }
    if ((applied.at(-1)?.version ?? 0) !== expectedSchemaVersion) {
      throw migrationError(
        'migration_backup_schema_mismatch',
        'Migration backup schema version changed during creation'
      );
    }
  } finally {
    candidate.close();
  }
  return metadata.size;
};

const createSchemaUpgradeBackup = async ({
  database,
  databasePath,
  files,
  appliedRows,
  pending,
  options,
}: {
  database: Database.Database;
  databasePath: string;
  files: MigrationFile[];
  appliedRows: AppliedMigration[];
  pending: MigrationFile[];
  options: MigrationOptions;
}): Promise<SchemaUpgradeBackup> => {
  const backupDirectory = resolve(dirname(databasePath), 'backups');
  await ensurePrivateBackupDirectory(backupDirectory);
  const sourceBytes =
    (await fileSize(databasePath)) +
    (await fileSize(`${databasePath}-wal`)) +
    (await fileSize(`${databasePath}-shm`));
  const requiredBytes = Math.max(minimumBackupFreeBytes, sourceBytes * 2);
  const availableBytes = options.availableBytes ?? availableFilesystemBytes;
  if ((await availableBytes(backupDirectory)) < requiredBytes) {
    throw migrationError(
      'migration_backup_space_insufficient',
      'Insufficient space for a verified migration backup'
    );
  }

  const artifactId = `bkp_${randomUUID()}`;
  const fileName = `${artifactId}.sqlite3`;
  const partialPath = resolve(backupDirectory, `${fileName}.partial`);
  const path = resolve(backupDirectory, fileName);
  const manifestPartialPath = resolve(backupDirectory, `${artifactId}.manifest.json.partial`);
  const manifestPath = resolve(backupDirectory, `${artifactId}.manifest.json`);
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const backupDatabase =
    options.backupDatabase ??
    (async (targetPath: string) => {
      await database.backup(targetPath);
    });

  try {
    await backupDatabase(partialPath);
    await chmod(partialPath, 0o600);
    await syncPath(partialPath);
    const sizeBytes = await validateUpgradeSnapshot(
      partialPath,
      files,
      appliedRows.at(-1)?.version ?? 0
    );
    const sha256 = await hashFile(partialPath);
    const manifest: SchemaUpgradeBackup['manifest'] = {
      formatVersion: 1,
      backupId: artifactId,
      createdAt,
      appBuild: options.appBuild ?? 'development',
      schemaVersion: appliedRows.at(-1)?.version ?? 0,
      fileName,
      sizeBytes,
      sha256,
      purpose: 'schema-upgrade',
      targetSchemaVersion: files.at(-1)?.version ?? 0,
      migrationChecksums: pending.map(migration => ({
        version: migration.version,
        name: migration.name,
        checksumSha256: migration.checksum,
      })),
    };
    await writeFile(manifestPartialPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await syncPath(manifestPartialPath);
    await rename(partialPath, path);
    await rename(manifestPartialPath, manifestPath);
    await syncPath(backupDirectory);
    return { artifactId, path, manifestPath, manifest };
  } catch (error) {
    await rm(partialPath, { force: true });
    await rm(manifestPartialPath, { force: true });
    if (errorCode(error) === 'ENOSPC') {
      throw migrationError(
        'migration_backup_space_exhausted',
        'Migration backup ran out of space while writing'
      );
    }
    throw error;
  }
};

const hasTable = (database: Database.Database, table: string) =>
  Boolean(
    database
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  );

const registerSchemaUpgradeBackup = (
  database: Database.Database,
  backup: SchemaUpgradeBackup | null
) => {
  if (!backup || !hasTable(database, 'backup_artifacts')) return;
  database
    .prepare(
      `INSERT INTO backup_artifacts
        (id, state, file_name, manifest_json, created_by, created_at, completed_at, error_code)
       VALUES (?, 'ready', ?, ?, 'system:schema-migration', ?, ?, NULL)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(
      backup.artifactId,
      backup.manifest.fileName,
      JSON.stringify(backup.manifest),
      backup.manifest.createdAt,
      backup.manifest.createdAt
    );
};

export const migrateDatabase = async (
  database: Database.Database,
  options: MigrationOptions
): Promise<MigrationResult> => {
  verifyDatabase(database);
  const applicationTables = hasApplicationTables(database);
  if (applicationTables && !hasTable(database, 'schema_migrations')) {
    throw migrationError(
      'migration_ledger_missing',
      'Application tables exist without a migration ledger'
    );
  }
  ensureLedger(database);

  const files = await loadMigrationFiles(options.directory);
  const appliedRows = verifyAppliedMigrations(database, files);

  const appliedVersions = new Set(appliedRows.map(row => row.version));
  const pending = files.filter(file => !appliedVersions.has(file.version));
  if (applicationTables && appliedRows.length === 0) {
    throw migrationError(
      'migration_ledger_missing',
      'Application tables exist without a migration ledger'
    );
  }
  let backup: SchemaUpgradeBackup | null = null;

  if (pending.length > 0 && options.databasePath && applicationTables) {
    backup = await createSchemaUpgradeBackup({
      database,
      databasePath: options.databasePath,
      files,
      appliedRows,
      pending,
      options,
    });
    registerSchemaUpgradeBackup(database, backup);
  }

  const insertLedger = database.prepare(
    `INSERT INTO schema_migrations
      (version, name, checksum_sha256, applied_at, app_build, execution_ms)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const applyMigration = database.transaction((migration: MigrationFile) => {
    const startedAt = performance.now();
    database.exec(migration.sql);
    insertLedger.run(
      migration.version,
      migration.name,
      migration.checksum,
      (options.now?.() ?? new Date()).toISOString(),
      options.appBuild ?? 'development',
      Math.max(0, Math.round(performance.now() - startedAt))
    );
  });

  for (const migration of pending) {
    applyMigration(migration);
    registerSchemaUpgradeBackup(database, backup);
  }

  verifyDatabase(database);
  return {
    applied: pending.map(migration => migration.version),
    currentVersion: files.at(-1)?.version ?? 0,
    backupPath: backup?.path ?? null,
    backupManifestPath: backup?.manifestPath ?? null,
    backupArtifactId: backup?.artifactId ?? null,
  };
};

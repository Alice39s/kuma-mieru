import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
}

export interface MigrationOptions {
  directory: string;
  databasePath?: string;
  appBuild?: string;
  now?: () => Date;
}

const migrationFileName = /^([0-9]{6})_([a-z0-9_]+)\.up\.sql$/;

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

export const migrateDatabase = async (
  database: Database.Database,
  options: MigrationOptions
): Promise<MigrationResult> => {
  ensureLedger(database);
  verifyDatabase(database);

  const files = await loadMigrationFiles(options.directory);
  const appliedRows = verifyAppliedMigrations(database, files);

  const appliedVersions = new Set(appliedRows.map(row => row.version));
  const pending = files.filter(file => !appliedVersions.has(file.version));
  let backupPath: string | null = null;

  if (pending.length > 0 && options.databasePath && hasApplicationTables(database)) {
    const timestamp = (options.now?.() ?? new Date()).toISOString().replaceAll(':', '-');
    backupPath = `${options.databasePath}.backup-${timestamp}`;
    await database.backup(backupPath);
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
  }

  verifyDatabase(database);
  return {
    applied: pending.map(migration => migration.version),
    currentVersion: files.at(-1)?.version ?? 0,
    backupPath,
  };
};

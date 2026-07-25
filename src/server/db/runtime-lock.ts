import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

export interface RuntimeLock {
  path: string;
  ownerToken: string;
  isHeld(): boolean;
  release(): void;
}

export interface AcquireRuntimeLockOptions {
  dataDirectory: string;
  appBuild: string;
  processId?: number;
  now?: () => Date;
}

const lockError = (code: string, message: string) => Object.assign(new Error(message), { code });

export const runtimeLockErrorCode = (error: unknown) =>
  typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'runtime_lock_failed';

const ensurePrivateRuntimeDirectory = async (path: string) => {
  try {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw lockError(
        'runtime_lock_directory_unsafe',
        'Runtime lock directory must be a real directory'
      );
    }
    await chmod(path, 0o700);
  } catch (error) {
    if (runtimeLockErrorCode(error).startsWith('runtime_lock_')) throw error;
    if (runtimeLockErrorCode(error) === 'EACCES' || runtimeLockErrorCode(error) === 'EPERM') {
      throw lockError('runtime_lock_permission_denied', 'Runtime lock directory is not writable');
    }
    throw error;
  }
};

const validateExistingLockPath = async (path: string) => {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw lockError('runtime_lock_path_unsafe', 'Runtime lock path must be a regular file');
    }
  } catch (error) {
    if (runtimeLockErrorCode(error) === 'ENOENT') return;
    throw error;
  }
};

export const acquireRuntimeLock = async ({
  dataDirectory,
  appBuild,
  processId = process.pid,
  now = () => new Date(),
}: AcquireRuntimeLockOptions): Promise<RuntimeLock> => {
  const runtimeDirectory = resolve(dataDirectory, '.runtime');
  const path = resolve(runtimeDirectory, 'kuma-mieru-runtime-lock.sqlite3');
  const ownerToken = randomUUID();
  await ensurePrivateRuntimeDirectory(runtimeDirectory);
  await validateExistingLockPath(path);

  let lockDatabase: BetterSqlite3.Database | null = null;
  try {
    lockDatabase = new BetterSqlite3(path);
    await chmod(path, 0o600);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw lockError('runtime_lock_path_unsafe', 'Runtime lock path must be a regular file');
    }
    lockDatabase.pragma('busy_timeout = 0');
    lockDatabase.pragma('journal_mode = DELETE');
    lockDatabase.pragma('synchronous = FULL');
    lockDatabase.exec(`
      CREATE TABLE IF NOT EXISTS runtime_lock_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        owner_token TEXT,
        process_id INTEGER,
        app_build TEXT,
        acquired_at TEXT
      );
      INSERT INTO runtime_lock_metadata (singleton)
      VALUES (1)
      ON CONFLICT(singleton) DO NOTHING;
    `);
    lockDatabase.exec('BEGIN EXCLUSIVE');
    lockDatabase
      .prepare(
        `UPDATE runtime_lock_metadata
         SET owner_token = ?, process_id = ?, app_build = ?, acquired_at = ?
         WHERE singleton = 1`
      )
      .run(ownerToken, processId, appBuild, now().toISOString());
  } catch (error) {
    if (lockDatabase?.open) lockDatabase.close();
    const code = runtimeLockErrorCode(error);
    if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
      throw lockError('runtime_lock_held', 'Another Kuma Mieru runtime owns this data directory');
    }
    if (code.startsWith('runtime_lock_')) throw error;
    if (code === 'SQLITE_NOTADB' || code === 'SQLITE_CORRUPT') {
      throw lockError('runtime_lock_invalid', 'Runtime lock database is invalid');
    }
    if (code === 'EACCES' || code === 'EPERM' || code === 'SQLITE_CANTOPEN') {
      throw lockError('runtime_lock_permission_denied', 'Runtime lock database is not writable');
    }
    throw error;
  }

  let held = true;
  const isHeld = () => held && Boolean(lockDatabase?.open) && Boolean(lockDatabase?.inTransaction);
  const release = () => {
    if (!held) return;
    held = false;
    try {
      if (lockDatabase?.open && lockDatabase.inTransaction) lockDatabase.exec('ROLLBACK');
    } finally {
      if (lockDatabase?.open) lockDatabase.close();
      lockDatabase = null;
    }
  };

  return { path, ownerToken, isHeld, release };
};

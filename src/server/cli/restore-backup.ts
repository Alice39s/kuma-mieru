import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupErrorCode, restoreBackupArtifact, validateBackupArtifact } from '../db/backup.js';

const argumentsList = process.argv.slice(2);
const argumentValue = (name: string) => {
  const index = argumentsList.indexOf(name);
  return index >= 0 ? argumentsList[index + 1] : undefined;
};
const backupId = argumentValue('--backup-id');
const execute = argumentsList.includes('--execute');
const dataDirectory = resolve(argumentValue('--data-dir') ?? './data');
const databasePath = resolve(dataDirectory, 'kuma-mieru.sqlite3');
const currentDirectory = fileURLToPath(new URL('.', import.meta.url));
const bundledMigrationDirectory = resolve(currentDirectory, '../migrations');
const migrationDirectory = process.env.KUMA_MIERU_MIGRATIONS_DIR
  ? resolve(process.env.KUMA_MIERU_MIGRATIONS_DIR)
  : existsSync(bundledMigrationDirectory)
    ? bundledMigrationDirectory
    : resolve(process.cwd(), 'migrations');

if (!backupId) {
  process.stderr.write(
    'Usage: bun run restore-backup -- --backup-id bkp_<uuid> [--data-dir ./data] [--execute]\n'
  );
  process.exit(2);
}

try {
  const validation = await validateBackupArtifact({
    backupId,
    dataDirectory,
    migrationDirectory,
  });
  if (!execute) {
    process.stdout.write(
      `${JSON.stringify({ mode: 'dry-run', ...validation }, null, 2)}\n` +
        'No files changed. Stop Kuma Mieru and pass --execute to perform the restore.\n'
    );
  } else {
    const restored = await restoreBackupArtifact({
      backupId,
      dataDirectory,
      databasePath,
      migrationDirectory,
    });
    process.stdout.write(
      `${JSON.stringify({ mode: 'executed', ...restored }, null, 2)}\n` +
        'Start Kuma Mieru and verify /health/ready. Retain the pre-restore file for rollback.\n'
    );
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      errorCode: backupErrorCode(error),
      message: error instanceof Error ? error.message : 'Backup restore failed',
    })}\n`
  );
  process.exit(1);
}

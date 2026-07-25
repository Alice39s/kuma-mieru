import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { retentionPolicySchema } from '../config/schema.js';

const markerSchema = z.object({
  formatVersion: z.literal(1),
  backupId: z.string().min(1).max(64),
  restoredAt: z.iso.datetime(),
  retentionPolicy: retentionPolicySchema.optional(),
});

export type PostRestoreRetentionMarker = z.infer<typeof markerSchema>;

const markerPath = (dataDirectory: string) =>
  resolve(dataDirectory, '.runtime', 'post-restore-retention.json');

const ensureRuntimeDirectory = async (dataDirectory: string) => {
  const directory = resolve(dataDirectory, '.runtime');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw Object.assign(new Error('Runtime directory must be a real directory'), {
      code: 'retention_marker_directory_unsafe',
    });
  }
  await chmod(directory, 0o700);
  return directory;
};

export const writePostRestoreRetentionMarker = async (
  dataDirectory: string,
  marker: PostRestoreRetentionMarker
) => {
  const directory = await ensureRuntimeDirectory(dataDirectory);
  const parsed = markerSchema.parse(marker);
  const path = markerPath(dataDirectory);
  const partialPath = resolve(directory, 'post-restore-retention.json.partial');
  await rm(partialPath, { force: true });
  const existing = await lstat(path).catch(() => null);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    throw Object.assign(new Error('Post-restore retention marker is unsafe'), {
      code: 'retention_marker_unsafe',
    });
  }
  await writeFile(partialPath, `${JSON.stringify(parsed)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(partialPath, 0o600);
  await rename(partialPath, path);
  await chmod(path, 0o600);
};

export const readPostRestoreRetentionMarker = async (
  dataDirectory: string
): Promise<PostRestoreRetentionMarker | null> => {
  const path = markerPath(dataDirectory);
  const metadata = await lstat(path).catch(() => null);
  if (!metadata) return null;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4096) {
    throw Object.assign(new Error('Post-restore retention marker is unsafe'), {
      code: 'retention_marker_unsafe',
    });
  }
  try {
    return markerSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    throw Object.assign(new Error('Post-restore retention marker is invalid'), {
      code: 'retention_marker_invalid',
    });
  }
};

export const clearPostRestoreRetentionMarker = async (dataDirectory: string) => {
  const path = markerPath(dataDirectory);
  const metadata = await lstat(path).catch(() => null);
  if (!metadata) return;
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw Object.assign(new Error('Post-restore retention marker is unsafe'), {
      code: 'retention_marker_unsafe',
    });
  }
  await rm(path);
};

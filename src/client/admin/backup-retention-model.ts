import type {
  AdminBackupArtifact,
  AdminRetentionPreview,
  AdminRetentionSummary,
  AdminSession,
} from './api';

export const canAccessLifecycle = (role: AdminSession['role']) => role === 'owner';

export const canDeleteBackup = (backup: AdminBackupArtifact) =>
  backup.state === 'ready' &&
  backup.retentionState === 'eligible' &&
  backup.deletionState === null &&
  backup.deletedAt === null &&
  backup.manifestSha256 !== null;

export const retentionCount = (
  values: AdminRetentionPreview['candidates'] | AdminRetentionSummary
) => Object.values(values).reduce((total, value) => total + value, 0);

export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1_024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1_024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
};

export const lifecycleErrorDescription = (error: unknown) => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'REAUTH_REQUIRED'
  ) {
    return 'This high-risk action needs a recent session. Sign out, sign in again, then retry.';
  }
  return error instanceof Error ? error.message : 'The operation was rejected.';
};

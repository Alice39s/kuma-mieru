import { describe, expect, test } from 'bun:test';
import type { AdminBackupArtifact } from './admin/api';
import {
  canAccessLifecycle,
  canDeleteBackup,
  formatBytes,
  lifecycleErrorDescription,
  retentionCount,
} from './admin/backup-retention-model';
import {
  backupDeleteConfirmationSchema,
  retentionPolicyDraftSchema,
  retentionRunConfirmationSchema,
} from './admin/schemas';

const eligibleBackup: AdminBackupArtifact = {
  id: 'bkp_00000000-0000-4000-8000-000000000000',
  state: 'ready',
  fileName: 'backup.sqlite3',
  manifest: null,
  createdBy: 'owner',
  createdAt: '2026-07-25T00:00:00.000Z',
  completedAt: '2026-07-25T00:00:01.000Z',
  errorCode: null,
  retentionState: 'eligible',
  retentionDecidedAt: '2026-07-25T00:00:02.000Z',
  manifestSha256: 'a'.repeat(64),
  deletionState: null,
  deletedAt: null,
};

describe('backup and retention workbench model', () => {
  test('exposes the lifecycle surface to owners only', () => {
    expect(canAccessLifecycle('owner')).toBe(true);
    expect(canAccessLifecycle('publisher')).toBe(false);
    expect(canAccessLifecycle('editor')).toBe(false);
    expect(canAccessLifecycle('viewer')).toBe(false);
  });

  test('only permits deletion of a ready, eligible, undeleted artifact with a manifest hash', () => {
    expect(canDeleteBackup(eligibleBackup)).toBe(true);
    expect(canDeleteBackup({ ...eligibleBackup, retentionState: 'current' })).toBe(false);
    expect(canDeleteBackup({ ...eligibleBackup, deletionState: 'staged' })).toBe(false);
    expect(canDeleteBackup({ ...eligibleBackup, manifestSha256: null })).toBe(false);
  });

  test('sums candidate counts and formats artifact sizes', () => {
    expect(
      retentionCount({
        pendingSubscriptionsExpired: 2,
        terminalSubscriptionsRedacted: 3,
        terminalDeliveryPayloadsRedacted: 0,
        expiredSubscriptionTokensDeleted: 0,
        deliveryAttemptsDeleted: 0,
        abuseRateLimitBucketsDeleted: 0,
        unpublishedTerminalEventsDeleted: 0,
        adminAuditRowsDeleted: 0,
        backupArtifactsMarkedEligible: 0,
        backupArtifactsMarkedCurrent: 0,
      })
    ).toBe(5);
    expect(formatBytes(1_536)).toBe('1.50 KiB');
    expect(formatBytes(5 * 1_024 * 1_024)).toBe('5.00 MiB');
  });

  test('turns recent-auth failures into an actionable recovery message', () => {
    expect(lifecycleErrorDescription({ code: 'REAUTH_REQUIRED' })).toContain('Sign out');
    expect(lifecycleErrorDescription(new Error('conflict'))).toBe('conflict');
  });

  test('keeps destructive confirmations exact and policy values inside server bounds', () => {
    expect(backupDeleteConfirmationSchema.safeParse({ confirmation: '' }).success).toBe(false);
    expect(
      retentionRunConfirmationSchema.safeParse({ confirmation: 'run retention' }).success
    ).toBe(false);
    expect(
      retentionRunConfirmationSchema.safeParse({ confirmation: 'RUN RETENTION' }).success
    ).toBe(true);
    expect(
      retentionPolicyDraftSchema.safeParse({
        eventDraftDays: 29,
        adminAuditDays: 365,
        deliveryAttemptDays: 90,
        backupDays: 30,
      }).success
    ).toBe(false);
  });
});

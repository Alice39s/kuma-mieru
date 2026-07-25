import { describe, expect, test } from 'bun:test';
import { auditResultLabel, auditTarget, canAccessAdminAudit } from './admin/audit-model';
import type { AdminAuditEntry } from './admin/api';

const entry: AdminAuditEntry = {
  id: 'audit-1',
  occurredAt: '2026-07-25T00:00:00.000Z',
  actorId: 'owner-1',
  action: 'retention.run',
  targetType: 'retention',
  targetId: 'run-1',
  result: 'failed',
  errorCode: 'RETENTION_IN_PROGRESS',
};

describe('admin audit workbench model', () => {
  test('exposes the full admin audit to owners only', () => {
    expect(canAccessAdminAudit('owner')).toBe(true);
    expect(canAccessAdminAudit('publisher')).toBe(false);
    expect(canAccessAdminAudit('editor')).toBe(false);
    expect(canAccessAdminAudit('viewer')).toBe(false);
  });

  test('presents stable result and target labels without deriving sensitive metadata', () => {
    expect(auditResultLabel('success')).toBe('Succeeded');
    expect(auditResultLabel('denied')).toBe('Denied');
    expect(auditResultLabel('failed')).toBe('Failed');
    expect(auditTarget(entry)).toBe('retention · run-1');
    expect(auditTarget({ ...entry, targetId: null })).toBe('retention');
  });
});

import type { AdminAuditEntry, AdminSession } from './api';

export const canAccessAdminAudit = (role: AdminSession['role']) => role === 'owner';

export const auditResultLabel = (result: AdminAuditEntry['result']) =>
  result === 'success' ? 'Succeeded' : result === 'denied' ? 'Denied' : 'Failed';

export const auditTarget = (entry: AdminAuditEntry) =>
  entry.targetId ? `${entry.targetType} · ${entry.targetId}` : entry.targetType;

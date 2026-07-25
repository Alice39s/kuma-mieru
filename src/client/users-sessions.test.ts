import { describe, expect, test } from 'bun:test';
import type { AdminSession, AdminUser, AdminUserSession } from './admin/api';
import {
  canAccessUsers,
  canChangeUserRole,
  canRevokeUserSession,
  matchesSessionConfirmation,
  matchesUserConfirmation,
  roleChangeWarning,
} from './admin/users-model';

const ownerSession: AdminSession = {
  userId: 'owner-1',
  role: 'owner',
  csrfToken: 'csrf',
};
const user: AdminUser = {
  id: 'viewer-1',
  name: 'Viewer',
  email: 'viewer@example.com',
  emailVerified: true,
  role: 'viewer',
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:00:00.000Z',
  activeSessionCount: 1,
  passkeyCount: 0,
};
const targetSession: AdminUserSession = {
  id: 'session-1',
  userId: user.id,
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:00:00.000Z',
  expiresAt: '2026-07-26T00:00:00.000Z',
  current: false,
};

describe('users and sessions permission model', () => {
  test('keeps the workspace owner-only and blocks self role changes', () => {
    expect(canAccessUsers('owner')).toBe(true);
    expect(canAccessUsers('publisher')).toBe(false);
    expect(canAccessUsers('editor')).toBe(false);
    expect(canAccessUsers('viewer')).toBe(false);
    expect(canChangeUserRole(ownerSession, user)).toBe(true);
    expect(canChangeUserRole(ownerSession, { ...user, id: ownerSession.userId })).toBe(false);
  });

  test('requires exact resource identifiers for high-risk confirmations', () => {
    expect(matchesUserConfirmation(user, 'viewer-1')).toBe(true);
    expect(matchesUserConfirmation(user, ' viewer-1 ')).toBe(true);
    expect(matchesUserConfirmation(user, user.email)).toBe(false);
    expect(matchesSessionConfirmation(targetSession, 'session-1')).toBe(true);
    expect(matchesSessionConfirmation(targetSession, 'session')).toBe(false);
  });

  test('never offers revocation for the current session', () => {
    expect(canRevokeUserSession(ownerSession, targetSession)).toBe(true);
    expect(canRevokeUserSession(ownerSession, { ...targetSession, current: true })).toBe(false);
    expect(canRevokeUserSession({ ...ownerSession, role: 'publisher' }, targetSession)).toBe(false);
  });

  test('surfaces the distinct owner grant warning', () => {
    expect(roleChangeWarning('owner')).toContain('complete');
    expect(roleChangeWarning('editor')).toContain('revokes');
  });
});

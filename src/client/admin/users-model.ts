import type { AdminRole, AdminSession, AdminUser, AdminUserSession } from './api';

export const adminRoleOptions: Array<{ value: AdminRole; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
];

export const canAccessUsers = (role: AdminSession['role']) => role === 'owner';

export const canChangeUserRole = (session: AdminSession, user: AdminUser) =>
  session.role === 'owner' && session.userId !== user.id;

export const canRevokeUserSession = (session: AdminSession, target: AdminUserSession) =>
  session.role === 'owner' && !target.current;

export const matchesUserConfirmation = (user: AdminUser, confirmation: string) =>
  confirmation.trim() === user.id;

export const matchesSessionConfirmation = (session: AdminUserSession, confirmation: string) =>
  confirmation.trim() === session.id;

export const roleChangeWarning = (role: AdminRole) =>
  role === 'owner'
    ? 'This grants complete control-plane access.'
    : 'This changes access immediately and revokes every active session for this user.';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, KeyRound, RefreshCw, ShieldAlert, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  changeAdminUserRole,
  createAdminUser,
  getAdminUsers,
  getAdminUserSessions,
  revokeAdminUserSession,
  type AdminRole,
  type AdminSession,
  type AdminUser,
  type AdminUserSession,
} from './api';
import {
  adminRoleOptions,
  canChangeUserRole,
  canRevokeUserSession,
  matchesSessionConfirmation,
  matchesUserConfirmation,
  roleChangeWarning,
} from './users-model';

const createUserSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a display name.').max(100),
    email: z.email('Enter a valid email address.').max(320),
    password: z.string().min(12, 'Use at least 12 characters.').max(200),
    role: z.enum(['publisher', 'editor', 'viewer']),
  })
  .strict();

type CreateUserInput = z.infer<typeof createUserSchema>;
type RoleReview = { user: AdminUser; role: AdminRole };

export const UsersSessions = ({ session }: { session: AdminSession }) => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AdminUserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, AdminRole>>({});
  const [roleReview, setRoleReview] = useState<RoleReview | null>(null);
  const [roleConfirmation, setRoleConfirmation] = useState('');
  const [roleSaving, setRoleSaving] = useState(false);
  const [sessionReview, setSessionReview] = useState<AdminUserSession | null>(null);
  const [sessionConfirmation, setSessionConfirmation] = useState('');
  const [sessionSaving, setSessionSaving] = useState(false);
  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', email: '', password: '', role: 'viewer' },
  });

  const selectedUser = useMemo(
    () => users.find(user => user.id === selectedUserId) ?? null,
    [selectedUserId, users]
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAdminUsers();
      setUsers(data);
      setSelectedUserId(current =>
        current && data.some(user => user.id === current) ? current : (data[0]?.id ?? null)
      );
      setRoleDrafts(
        Object.fromEntries(data.map(user => [user.id, user.role])) as Record<string, AdminRole>
      );
    } catch (error) {
      toast.error('Users are unavailable', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async (userId: string) => {
    try {
      setSessions(await getAdminUserSessions(userId));
    } catch (error) {
      setSessions([]);
      toast.error('Sessions are unavailable', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (selectedUserId) void loadSessions(selectedUserId);
    else setSessions([]);
  }, [loadSessions, selectedUserId]);

  const create = form.handleSubmit(async input => {
    setCreating(true);
    try {
      await createAdminUser(session, input);
      form.reset({ name: '', email: '', password: '', role: 'viewer' });
      toast.success('User created', {
        description: 'The password is write-only and cannot be viewed again.',
      });
      await loadUsers();
    } catch (error) {
      toast.error('User was not created', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setCreating(false);
    }
  });

  const openRoleReview = (user: AdminUser) => {
    const role = roleDrafts[user.id] ?? user.role;
    if (role === user.role) {
      toast.info('Select a different role first.');
      return;
    }
    setRoleConfirmation('');
    setRoleReview({ user, role });
  };

  const commitRole = async () => {
    if (!roleReview || !matchesUserConfirmation(roleReview.user, roleConfirmation)) return;
    setRoleSaving(true);
    try {
      const result = await changeAdminUserRole(session, roleReview.user.id, {
        expectedRole: roleReview.user.role,
        role: roleReview.role,
      });
      toast.success('Role changed', {
        description: `${result.data.revokedSessions} session(s) revoked.`,
      });
      setRoleReview(null);
      setRoleConfirmation('');
      await loadUsers();
      if (selectedUserId === roleReview.user.id) await loadSessions(roleReview.user.id);
    } catch (error) {
      toast.error('Role was not changed', {
        description: error instanceof Error ? error.message : undefined,
      });
      await loadUsers();
    } finally {
      setRoleSaving(false);
    }
  };

  const openSessionReview = (target: AdminUserSession) => {
    setSessionConfirmation('');
    setSessionReview(target);
  };

  const commitSessionRevocation = async () => {
    if (
      !selectedUser ||
      !sessionReview ||
      !matchesSessionConfirmation(sessionReview, sessionConfirmation)
    ) {
      return;
    }
    setSessionSaving(true);
    try {
      await revokeAdminUserSession(session, selectedUser.id, sessionReview.id);
      toast.success('Session revoked');
      setSessionReview(null);
      setSessionConfirmation('');
      await Promise.all([loadUsers(), loadSessions(selectedUser.id)]);
    } catch (error) {
      toast.error('Session was not revoked', {
        description: error instanceof Error ? error.message : undefined,
      });
      await loadSessions(selectedUser.id);
    } finally {
      setSessionSaving(false);
    }
  };

  return (
    <div className="access-workspace">
      <header className="workbench-page-heading access-heading">
        <div>
          <p className="admin-eyebrow">Owner-only access control</p>
          <h1>Access should be narrow and reversible.</h1>
          <p>
            Create named operators, grant only the role they need, and invalidate sessions without
            ever exposing session tokens, network metadata, or credential material.
          </p>
        </div>
        <button
          aria-label="Refresh users"
          className="admin-secondary-button"
          disabled={loading}
          onClick={() => void loadUsers()}
          type="button"
        >
          <RefreshCw aria-hidden="true" className={loading ? 'is-spinning' : ''} size={16} />
          Refresh
        </button>
      </header>

      <div className="access-grid">
        <section className="access-user-ledger">
          <header className="access-section-heading">
            <div>
              <p className="admin-eyebrow">Principals</p>
              <h2>Users</h2>
            </div>
            <span>{users.length}</span>
          </header>
          <div className="access-user-list">
            {users.map(user => (
              <article className={selectedUserId === user.id ? 'is-selected' : ''} key={user.id}>
                <button
                  className="access-user-summary"
                  onClick={() => setSelectedUserId(user.id)}
                  type="button"
                >
                  <span className="access-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
                  <span>
                    <strong>
                      {user.name}
                      {user.id === session.userId ? <em>you</em> : null}
                    </strong>
                    <small>{user.email}</small>
                  </span>
                </button>
                <div className="access-user-facts">
                  <span>
                    <KeyRound aria-hidden="true" size={13} /> {user.activeSessionCount} sessions
                  </span>
                  <span>{user.passkeyCount} passkeys</span>
                </div>
                <div className="access-role-control">
                  <select
                    aria-label={`Role for ${user.name}`}
                    disabled={!canChangeUserRole(session, user)}
                    onChange={event =>
                      setRoleDrafts(current => ({
                        ...current,
                        [user.id]: event.target.value as AdminRole,
                      }))
                    }
                    value={roleDrafts[user.id] ?? user.role}
                  >
                    {adminRoleOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="admin-secondary-button"
                    disabled={
                      !canChangeUserRole(session, user) ||
                      (roleDrafts[user.id] ?? user.role) === user.role
                    }
                    onClick={() => openRoleReview(user)}
                    type="button"
                  >
                    Review
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="access-create-card">
          <header className="access-section-heading">
            <div>
              <p className="admin-eyebrow">Provision</p>
              <h2>Create a user</h2>
            </div>
            <UserPlus aria-hidden="true" size={20} />
          </header>
          <form className="admin-form" onSubmit={create}>
            <label className="admin-field">
              <span>Display name</span>
              <input autoComplete="name" {...form.register('name')} />
              {form.formState.errors.name ? (
                <small>{form.formState.errors.name.message}</small>
              ) : null}
            </label>
            <label className="admin-field">
              <span>Email</span>
              <input autoComplete="email" type="email" {...form.register('email')} />
              {form.formState.errors.email ? (
                <small>{form.formState.errors.email.message}</small>
              ) : null}
            </label>
            <label className="admin-field">
              <span>Initial password</span>
              <input
                autoComplete="new-password"
                placeholder="At least 12 characters"
                type="password"
                {...form.register('password')}
              />
              {form.formState.errors.password ? (
                <small>{form.formState.errors.password.message}</small>
              ) : (
                <small>Write-only. Share it through a separate secure channel.</small>
              )}
            </label>
            <label className="admin-field">
              <span>Initial role</span>
              <select {...form.register('role')}>
                {adminRoleOptions
                  .filter(option => option.value !== 'owner')
                  .map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
              </select>
              <small>Owner access is granted later through the confirmed role-change flow.</small>
            </label>
            <button className="admin-primary-button" disabled={creating} type="submit">
              <UserPlus aria-hidden="true" size={16} />
              {creating ? 'Creating…' : 'Create user'}
            </button>
          </form>
        </section>
      </div>

      <section className="access-session-card">
        <header className="access-section-heading">
          <div>
            <p className="admin-eyebrow">Active credentials</p>
            <h2>{selectedUser ? `Sessions for ${selectedUser.name}` : 'Sessions'}</h2>
          </div>
          <span>{sessions.length}</span>
        </header>
        {sessions.length ? (
          <div className="access-session-list">
            {sessions.map(target => (
              <article key={target.id}>
                <span className="access-session-icon">
                  {target.current ? (
                    <CheckCircle2 aria-hidden="true" size={18} />
                  ) : (
                    <KeyRound aria-hidden="true" size={18} />
                  )}
                </span>
                <div>
                  <strong>
                    {target.id}
                    {target.current ? <em>current</em> : null}
                  </strong>
                  <small>
                    Created {new Date(target.createdAt).toLocaleString()} · expires{' '}
                    {new Date(target.expiresAt).toLocaleString()}
                  </small>
                </div>
                <button
                  className="admin-danger-button"
                  disabled={!canRevokeUserSession(session, target)}
                  onClick={() => openSessionReview(target)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={15} />
                  {target.current ? 'Sign out instead' : 'Revoke'}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="editor-empty">
            <strong>No active session for this user.</strong>
          </div>
        )}
      </section>

      {roleReview ? (
        <section className="access-risk-review" aria-live="polite">
          <ShieldAlert aria-hidden="true" size={22} />
          <div>
            <p className="admin-eyebrow">High-risk review</p>
            <h2>
              Change {roleReview.user.name} from {roleReview.user.role} to {roleReview.role}
            </h2>
            <p>{roleChangeWarning(roleReview.role)}</p>
            <label className="admin-field">
              <span>
                Type <code>{roleReview.user.id}</code> to confirm
              </span>
              <input
                autoComplete="off"
                onChange={event => setRoleConfirmation(event.target.value)}
                value={roleConfirmation}
              />
            </label>
            <div className="access-review-actions">
              <button
                className="admin-secondary-button"
                onClick={() => setRoleReview(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="admin-danger-button"
                disabled={roleSaving || !matchesUserConfirmation(roleReview.user, roleConfirmation)}
                onClick={() => void commitRole()}
                type="button"
              >
                {roleSaving ? 'Applying…' : 'Change role and revoke sessions'}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {sessionReview ? (
        <section className="access-risk-review" aria-live="polite">
          <ShieldAlert aria-hidden="true" size={22} />
          <div>
            <p className="admin-eyebrow">Session revocation review</p>
            <h2>Invalidate this session immediately</h2>
            <p>The browser holding this session must authenticate again.</p>
            <label className="admin-field">
              <span>
                Type <code>{sessionReview.id}</code> to confirm
              </span>
              <input
                autoComplete="off"
                onChange={event => setSessionConfirmation(event.target.value)}
                value={sessionConfirmation}
              />
            </label>
            <div className="access-review-actions">
              <button
                className="admin-secondary-button"
                onClick={() => setSessionReview(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="admin-danger-button"
                disabled={
                  sessionSaving || !matchesSessionConfirmation(sessionReview, sessionConfirmation)
                }
                onClick={() => void commitSessionRevocation()}
                type="button"
              >
                {sessionSaving ? 'Revoking…' : 'Revoke session'}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
};

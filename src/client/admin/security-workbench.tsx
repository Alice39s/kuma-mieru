import { zodResolver } from '@hookform/resolvers/zod';
import { startRegistration } from '@simplewebauthn/browser';
import {
  Fingerprint,
  KeyRound,
  Laptop,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  beginPasskeyRegistration,
  completePasskeyRegistration,
  deleteAdminPasskey,
  getAdminPasskeys,
  renameAdminPasskey,
  type AdminPasskey,
  type AdminSession,
} from './api';
import {
  canUsePasskeys,
  matchesPasskeyConfirmation,
  passkeyLabel,
  passkeyUnavailableReason,
} from './passkey-model';
import { TwoFactorSecurity } from './two-factor-security';

const registrationSchema = z
  .object({
    name: z.string().trim().min(1, 'Give this passkey a recognizable name.').max(100),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']),
  })
  .strict();

type RegistrationInput = z.infer<typeof registrationSchema>;

export const SecurityWorkbench = ({ session }: { session: AdminSession }) => {
  const [passkeys, setPasskeys] = useState<AdminPasskey[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AdminPasskey | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminPasskey | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const form = useForm<RegistrationInput>({
    resolver: zodResolver(registrationSchema),
    defaultValues: { name: '', authenticatorAttachment: 'platform' },
  });
  const environment = useMemo(
    () => ({
      secureContext: typeof window !== 'undefined' && window.isSecureContext,
      publicKeyCredential:
        typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined',
    }),
    []
  );
  const available = canUsePasskeys(environment);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setPasskeys(await getAdminPasskeys());
    } catch (error) {
      toast.error('Passkeys are unavailable', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const register = form.handleSubmit(async input => {
    if (!available) return;
    setRegistering(true);
    try {
      const ceremony = await beginPasskeyRegistration(session, input);
      const response = await startRegistration({ optionsJSON: ceremony.data.options });
      const { clientExtensionResults: _clientExtensionResults, ...responseBody } = response;
      await completePasskeyRegistration(session, {
        name: ceremony.data.name,
        response: responseBody,
      });
      form.reset({ name: '', authenticatorAttachment: 'platform' });
      toast.success('Passkey registered', {
        description: 'The credential is now available for this account.',
      });
      await reload();
    } catch (error) {
      toast.error('Passkey was not registered', {
        description:
          error instanceof Error
            ? error.message
            : 'The browser ceremony was cancelled or could not be verified.',
      });
    } finally {
      setRegistering(false);
    }
  });

  const openRename = (passkey: AdminPasskey) => {
    setRenameTarget(passkey);
    setRenameValue(passkey.name ?? '');
  };

  const commitRename = async () => {
    if (!renameTarget || !renameValue.trim() || renameValue.trim() === renameTarget.name) return;
    setRenaming(true);
    try {
      await renameAdminPasskey(session, renameTarget.id, {
        expectedName: renameTarget.name,
        name: renameValue.trim(),
      });
      toast.success('Passkey renamed');
      setRenameTarget(null);
      await reload();
    } catch (error) {
      toast.error('Passkey was not renamed', {
        description: error instanceof Error ? error.message : undefined,
      });
      await reload();
    } finally {
      setRenaming(false);
    }
  };

  const openDelete = (passkey: AdminPasskey) => {
    setDeleteTarget(passkey);
    setDeleteConfirmation('');
  };

  const commitDelete = async () => {
    if (!deleteTarget || !matchesPasskeyConfirmation(deleteTarget, deleteConfirmation)) return;
    setDeleting(true);
    try {
      await deleteAdminPasskey(session, deleteTarget.id, deleteTarget.name);
      toast.success('Passkey deleted');
      setDeleteTarget(null);
      setDeleteConfirmation('');
      await reload();
    } catch (error) {
      toast.error('Passkey was not deleted', {
        description: error instanceof Error ? error.message : undefined,
      });
      await reload();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="security-workspace">
      <header className="workbench-page-heading security-heading">
        <div>
          <p className="admin-eyebrow">Personal authentication</p>
          <h1>Your credentials stay yours.</h1>
          <p>
            Register phishing-resistant WebAuthn credentials for this account. Public keys and
            credential identifiers are absent from the management projection; registration only
            exchanges the opaque credential descriptors required by the WebAuthn ceremony.
          </p>
        </div>
        <button
          className="admin-secondary-button"
          disabled={loading}
          onClick={() => void reload()}
          type="button"
        >
          <RefreshCw aria-hidden="true" className={loading ? 'is-spinning' : ''} size={16} />
          Refresh
        </button>
      </header>

      {!available ? (
        <section className="security-unavailable">
          <ShieldAlert aria-hidden="true" size={22} />
          <div>
            <strong>WebAuthn is unavailable in this browser context.</strong>
            <p>{passkeyUnavailableReason(environment)}</p>
          </div>
        </section>
      ) : null}

      <TwoFactorSecurity session={session} />

      <div className="security-grid">
        <section className="security-passkey-card">
          <header className="access-section-heading">
            <div>
              <p className="admin-eyebrow">Registered authenticators</p>
              <h2>Passkeys</h2>
            </div>
            <span>{passkeys.length}</span>
          </header>
          {passkeys.length ? (
            <div className="security-passkey-list">
              {passkeys.map(passkey => (
                <article key={passkey.id}>
                  <span className="security-passkey-icon">
                    {passkey.deviceType === 'multiDevice' ? (
                      <Fingerprint aria-hidden="true" size={19} />
                    ) : (
                      <Laptop aria-hidden="true" size={19} />
                    )}
                  </span>
                  <div>
                    <strong>{passkeyLabel(passkey)}</strong>
                    <small>
                      {passkey.deviceType} · {passkey.backedUp ? 'synced backup' : 'device bound'}
                      {passkey.createdAt
                        ? ` · added ${new Date(passkey.createdAt).toLocaleDateString()}`
                        : ''}
                    </small>
                  </div>
                  <div className="security-passkey-actions">
                    <button
                      aria-label={`Rename ${passkeyLabel(passkey)}`}
                      className="admin-secondary-button"
                      onClick={() => openRename(passkey)}
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={14} /> Rename
                    </button>
                    <button
                      aria-label={`Delete ${passkeyLabel(passkey)}`}
                      className="admin-danger-button"
                      onClick={() => openDelete(passkey)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={14} /> Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="editor-empty">
              <strong>No passkey registered.</strong>
              <p>Password recovery remains available until a passkey is added.</p>
            </div>
          )}
        </section>

        <section className="security-register-card">
          <header className="access-section-heading">
            <div>
              <p className="admin-eyebrow">New credential</p>
              <h2>Register a passkey</h2>
            </div>
            <KeyRound aria-hidden="true" size={20} />
          </header>
          <form className="admin-form" onSubmit={register}>
            <label className="admin-field">
              <span>Passkey name</span>
              <input autoComplete="off" placeholder="MacBook Touch ID" {...form.register('name')} />
              {form.formState.errors.name ? (
                <small>{form.formState.errors.name.message}</small>
              ) : (
                <small>Use a label that helps you identify the authenticator later.</small>
              )}
            </label>
            <label className="admin-field">
              <span>Authenticator preference</span>
              <select {...form.register('authenticatorAttachment')}>
                <option value="platform">This device</option>
                <option value="cross-platform">Security key or another device</option>
              </select>
            </label>
            <button
              className="admin-primary-button"
              disabled={!available || registering}
              type="submit"
            >
              <Fingerprint aria-hidden="true" size={16} />
              {registering ? 'Waiting for authenticator…' : 'Register passkey'}
            </button>
            <p className="security-recent-note">
              Registration requires a session created within the last five minutes. Sign out and
              back in if the server requests recent authentication.
            </p>
          </form>
        </section>
      </div>

      {renameTarget ? (
        <section className="security-review-card">
          <Pencil aria-hidden="true" size={20} />
          <div>
            <p className="admin-eyebrow">Rename credential</p>
            <h2>{passkeyLabel(renameTarget)}</h2>
            <label className="admin-field">
              <span>New name</span>
              <input
                autoComplete="off"
                maxLength={100}
                onChange={event => setRenameValue(event.target.value)}
                value={renameValue}
              />
            </label>
            <div className="access-review-actions">
              <button
                className="admin-secondary-button"
                onClick={() => setRenameTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="admin-primary-button"
                disabled={
                  renaming || !renameValue.trim() || renameValue.trim() === renameTarget.name
                }
                onClick={() => void commitRename()}
                type="button"
              >
                {renaming ? 'Saving…' : 'Save name'}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {deleteTarget ? (
        <section className="access-risk-review" aria-live="polite">
          <ShieldAlert aria-hidden="true" size={22} />
          <div>
            <p className="admin-eyebrow">Credential deletion review</p>
            <h2>Delete {passkeyLabel(deleteTarget)}</h2>
            <p>This authenticator will stop working immediately. Password recovery is unchanged.</p>
            <label className="admin-field">
              <span>
                Type <code>{deleteTarget.id}</code> to confirm
              </span>
              <input
                autoComplete="off"
                onChange={event => setDeleteConfirmation(event.target.value)}
                value={deleteConfirmation}
              />
            </label>
            <div className="access-review-actions">
              <button
                className="admin-secondary-button"
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="admin-danger-button"
                disabled={deleting || !matchesPasskeyConfirmation(deleteTarget, deleteConfirmation)}
                onClick={() => void commitDelete()}
                type="button"
              >
                {deleting ? 'Deleting…' : 'Delete passkey'}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
};

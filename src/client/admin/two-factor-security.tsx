import { zodResolver } from '@hookform/resolvers/zod';
import {
  Check,
  Clipboard,
  Download,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  beginAdminTwoFactorSetup,
  disableAdminTwoFactor,
  getAdminTwoFactorStatus,
  regenerateAdminRecoveryCodes,
  verifyAdminTwoFactorSetup,
  type AdminSession,
  type AdminTwoFactorStatus,
} from './api';

const passwordSchema = z
  .object({ password: z.string().min(1, 'Enter your current password.').max(1024) })
  .strict();

const verificationSchema = z
  .object({
    code: z
      .string()
      .trim()
      .length(6, 'Enter the complete six-digit code.')
      .refine(
        code => [...code].every(character => character >= '0' && character <= '9'),
        'The authenticator code must contain only digits.'
      ),
    codesSaved: z.boolean().refine(Boolean, {
      message:
        'Confirm that the recovery codes are stored before enabling two-factor authentication.',
    }),
  })
  .strict();

type PasswordInput = z.infer<typeof passwordSchema>;
type VerificationInput = z.infer<typeof verificationSchema>;
type PasswordIntent = 'setup' | 'recovery' | 'disable' | null;

interface SetupMaterial {
  totpURI: string;
  backupCodes: string[];
  qrCode: string;
}

const saveRecoveryCodes = (codes: string[]) => {
  const file = new Blob(
    [
      'Kuma Mieru recovery codes\n',
      'Each code can be used once. Keep this file offline and private.\n\n',
      codes.join('\n'),
      '\n',
    ],
    { type: 'text/plain;charset=utf-8' }
  );
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kuma-mieru-recovery-codes.txt';
  link.click();
  URL.revokeObjectURL(url);
};

const RecoveryCodes = ({ codes, onClose }: { codes: string[]; onClose?: () => void }) => (
  <section className="two-factor-codes" aria-live="polite">
    <header>
      <div>
        <p className="admin-eyebrow">Shown once</p>
        <h3>Store these recovery codes now</h3>
      </div>
      {onClose ? (
        <button
          aria-label="Hide recovery codes"
          className="admin-quiet-button"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      ) : null}
    </header>
    <p>Each code is single-use. Generating another set invalidates every code shown here.</p>
    <div className="two-factor-code-grid">
      {codes.map(code => (
        <code key={code}>{code}</code>
      ))}
    </div>
    <div className="access-review-actions">
      <button
        className="admin-secondary-button"
        onClick={() => {
          void navigator.clipboard
            .writeText(codes.join('\n'))
            .then(() => toast.success('Recovery codes copied'))
            .catch(() => toast.error('The browser could not copy recovery codes'));
        }}
        type="button"
      >
        <Clipboard aria-hidden="true" size={15} /> Copy
      </button>
      <button
        className="admin-secondary-button"
        onClick={() => saveRecoveryCodes(codes)}
        type="button"
      >
        <Download aria-hidden="true" size={15} /> Download
      </button>
    </div>
  </section>
);

export const TwoFactorSecurity = ({ session }: { session: AdminSession }) => {
  const [status, setStatus] = useState<AdminTwoFactorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [intent, setIntent] = useState<PasswordIntent>(null);
  const [setup, setSetup] = useState<SetupMaterial | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const passwordForm = useForm<PasswordInput>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '' },
  });
  const verificationForm = useForm<VerificationInput>({
    resolver: zodResolver(verificationSchema),
    defaultValues: { code: '', codesSaved: false },
  });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await getAdminTwoFactorStatus());
    } catch (error) {
      toast.error('Two-factor status is unavailable', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const requestPassword = (nextIntent: Exclude<PasswordIntent, null>) => {
    setIntent(nextIntent);
    passwordForm.reset({ password: '' });
  };

  const submitPassword = passwordForm.handleSubmit(async ({ password }) => {
    if (!intent) return;
    try {
      if (intent === 'setup') {
        const result = await beginAdminTwoFactorSetup(session, password);
        const qrCode = await QRCode.toDataURL(result.data.totpURI, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 256,
          color: { dark: '#10211bff', light: '#ffffffff' },
        });
        setSetup({ ...result.data, qrCode });
        setRecoveryCodes(null);
        verificationForm.reset({ code: '', codesSaved: false });
        toast.success('Authenticator setup started');
      } else if (intent === 'recovery') {
        const result = await regenerateAdminRecoveryCodes(session, password);
        setRecoveryCodes(result.data.backupCodes);
        toast.success('New recovery codes generated');
      } else {
        await disableAdminTwoFactor(session, password);
        toast.success(status?.setupPending ? 'Pending setup cancelled' : 'Two-factor disabled');
        window.location.reload();
        return;
      }
      setIntent(null);
      passwordForm.reset({ password: '' });
      await reload();
    } catch (error) {
      toast.error(
        intent === 'setup'
          ? 'Setup could not be started'
          : intent === 'recovery'
            ? 'Recovery codes were not regenerated'
            : 'Two-factor was not disabled',
        { description: error instanceof Error ? error.message : undefined }
      );
    }
  });

  const verifySetup = verificationForm.handleSubmit(async ({ code }) => {
    try {
      await verifyAdminTwoFactorSetup(session, { code });
      setSetup(null);
      toast.success('Two-factor authentication enabled');
      window.location.reload();
    } catch (error) {
      toast.error('Authenticator code was not accepted', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  });

  const statusLabel = status?.enabled
    ? 'Enabled'
    : status?.setupPending
      ? 'Setup pending'
      : 'Not enabled';

  return (
    <section className="two-factor-card">
      <header className="access-section-heading">
        <div>
          <p className="admin-eyebrow">Sign-in hardening</p>
          <h2>Authenticator & recovery codes</h2>
        </div>
        <span className={status?.enabled ? 'is-enabled' : ''}>
          {loading ? 'Reading…' : statusLabel}
        </span>
      </header>
      <div className="two-factor-summary">
        <span className="security-passkey-icon">
          {status?.enabled ? (
            <ShieldCheck aria-hidden="true" size={20} />
          ) : (
            <KeyRound aria-hidden="true" size={20} />
          )}
        </span>
        <div>
          <strong>
            {status?.enabled
              ? 'A second factor is required after password sign-in.'
              : status?.setupPending
                ? 'Finish verification or restart the interrupted setup.'
                : 'Add a time-based authenticator before relying on recovery codes.'}
          </strong>
          <p>
            Secrets and encrypted recovery-code storage never appear in this management projection.
            A new recovery-code set is returned only in the response that creates it.
          </p>
        </div>
        <div className="security-passkey-actions">
          {!status?.enabled ? (
            <button
              className="admin-primary-button"
              disabled={loading}
              onClick={() => requestPassword('setup')}
              type="button"
            >
              <KeyRound aria-hidden="true" size={15} />
              {status?.setupPending ? 'Restart setup' : 'Set up'}
            </button>
          ) : (
            <button
              className="admin-secondary-button"
              onClick={() => requestPassword('recovery')}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={15} /> New recovery codes
            </button>
          )}
          {status?.enabled || status?.setupPending ? (
            <button
              className="admin-danger-button"
              onClick={() => requestPassword('disable')}
              type="button"
            >
              <ShieldOff aria-hidden="true" size={15} />
              {status.setupPending ? 'Cancel setup' : 'Disable'}
            </button>
          ) : null}
        </div>
      </div>

      {intent ? (
        <form className="two-factor-password-review admin-form" onSubmit={submitPassword}>
          <div>
            <p className="admin-eyebrow">Recent credential check</p>
            <h3>
              {intent === 'setup'
                ? 'Start authenticator setup'
                : intent === 'recovery'
                  ? 'Replace every recovery code'
                  : status?.setupPending
                    ? 'Cancel pending setup'
                    : 'Disable two-factor authentication'}
            </h3>
          </div>
          <label className="admin-field">
            <span>Current password</span>
            <input
              autoComplete="current-password"
              type="password"
              {...passwordForm.register('password')}
            />
            {passwordForm.formState.errors.password ? (
              <small>{passwordForm.formState.errors.password.message}</small>
            ) : null}
          </label>
          <div className="access-review-actions">
            <button
              className="admin-secondary-button"
              onClick={() => setIntent(null)}
              type="button"
            >
              Cancel
            </button>
            <button
              className={intent === 'disable' ? 'admin-danger-button' : 'admin-primary-button'}
              disabled={passwordForm.formState.isSubmitting}
              type="submit"
            >
              {passwordForm.formState.isSubmitting ? 'Checking…' : 'Continue'}
            </button>
          </div>
        </form>
      ) : null}

      {setup ? (
        <div className="two-factor-setup">
          <section className="two-factor-qr">
            <img alt="Authenticator setup QR code" height="256" src={setup.qrCode} width="256" />
            <div>
              <p className="admin-eyebrow">Step one</p>
              <h3>Scan with your authenticator</h3>
              <p>
                If scanning is unavailable, copy the setup URI into a trusted authenticator. It
                contains the secret, so do not paste it into support tickets or logs.
              </p>
              <button
                className="admin-secondary-button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(setup.totpURI)
                    .then(() => toast.success('Setup URI copied'))
                    .catch(() => toast.error('The browser could not copy the setup URI'));
                }}
                type="button"
              >
                <Clipboard aria-hidden="true" size={15} /> Copy setup URI
              </button>
            </div>
          </section>
          <RecoveryCodes codes={setup.backupCodes} />
          <form className="two-factor-verify admin-form" onSubmit={verifySetup}>
            <div>
              <p className="admin-eyebrow">Final verification</p>
              <h3>Prove the authenticator is ready</h3>
            </div>
            <label className="admin-field">
              <span>Six-digit code</span>
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                {...verificationForm.register('code')}
              />
              {verificationForm.formState.errors.code ? (
                <small>{verificationForm.formState.errors.code.message}</small>
              ) : null}
            </label>
            <label className="auth-checkbox">
              <input type="checkbox" {...verificationForm.register('codesSaved')} />
              <span>I stored the recovery codes in a private, durable location.</span>
            </label>
            {verificationForm.formState.errors.codesSaved ? (
              <small className="two-factor-confirmation-error">
                {verificationForm.formState.errors.codesSaved.message}
              </small>
            ) : null}
            <button
              className="admin-primary-button"
              disabled={verificationForm.formState.isSubmitting}
              type="submit"
            >
              <Check aria-hidden="true" size={16} />
              {verificationForm.formState.isSubmitting ? 'Verifying…' : 'Enable two-factor'}
            </button>
          </form>
        </div>
      ) : null}

      {recoveryCodes ? (
        <RecoveryCodes codes={recoveryCodes} onClose={() => setRecoveryCodes(null)} />
      ) : null}
    </section>
  );
};

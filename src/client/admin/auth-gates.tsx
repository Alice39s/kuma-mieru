import { zodResolver } from '@hookform/resolvers/zod';
import { startAuthentication } from '@simplewebauthn/browser';
import { ArrowLeft, ArrowRight, Fingerprint, KeyRound, ShieldCheck } from 'lucide-react';
import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import {
  beginPasskeySignIn,
  completePasskeySignIn,
  createOwner,
  signIn,
  verifySignInBackupCode,
  verifySignInTotp,
} from './api';
import { canUsePasskeys } from './passkey-model';
import {
  ownerSetupSchema,
  signInSchema,
  twoFactorChallengeSchema,
  type OwnerSetupInput,
  type SignInInput,
  type TwoFactorChallengeInput,
} from './schemas';

interface AuthGateProps {
  onComplete: () => void;
}

const Field = ({
  label,
  error,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) => (
  <label className="admin-field">
    <span>{label}</span>
    <input {...input} />
    {error ? <small role="alert">{error}</small> : null}
  </label>
);

const AuthStage = ({
  eyebrow,
  title,
  description,
  icon,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) => (
  <div className="auth-stage">
    <aside className="auth-manifesto">
      <div className="auth-mark">{icon}</div>
      <div>
        <p className="admin-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="auth-rule">
        <span>Local-first control plane</span>
        <span>Revisioned by design</span>
        <span>Public surface stays read-only</span>
      </div>
    </aside>
    <main className="auth-form-panel">{children}</main>
  </div>
);

export const SetupGate = ({ onComplete }: AuthGateProps) => {
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<OwnerSetupInput>({
    resolver: zodResolver(ownerSetupSchema),
    defaultValues: { token: '', name: '', email: '', password: '' },
  });
  const submit = form.handleSubmit(async input => {
    setFailure(null);
    try {
      await createOwner(input);
      onComplete();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Owner setup failed.');
    }
  });

  return (
    <AuthStage
      eyebrow="First-run ceremony"
      title="Establish the owner."
      description="The setup token is short-lived and accepted once. After this step, public bootstrap closes permanently."
      icon={<Fingerprint size={29} />}
    >
      <div className="auth-form-heading">
        <span className="auth-step">01 / 01</span>
        <h2>Create the first owner</h2>
        <p>Use the token printed once in the server startup log.</p>
      </div>
      <form onSubmit={submit} className="admin-form">
        <Field
          label="Setup token"
          type="password"
          autoComplete="one-time-code"
          {...form.register('token')}
          error={form.formState.errors.token?.message}
        />
        <div className="admin-form-row">
          <Field
            label="Display name"
            autoComplete="name"
            {...form.register('name')}
            error={form.formState.errors.name?.message}
          />
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            {...form.register('email')}
            error={form.formState.errors.email?.message}
          />
        </div>
        <Field
          label="Recovery password"
          type="password"
          autoComplete="new-password"
          {...form.register('password')}
          error={form.formState.errors.password?.message}
        />
        {failure ? <p className="admin-form-error">{failure}</p> : null}
        <button
          className="admin-primary-button"
          disabled={form.formState.isSubmitting}
          type="submit"
        >
          {form.formState.isSubmitting ? 'Creating owner…' : 'Create owner'}
          <ArrowRight size={17} />
        </button>
      </form>
    </AuthStage>
  );
};

export const LoginGate = ({ onComplete }: AuthGateProps) => {
  const [failure, setFailure] = useState<string | null>(null);
  const [stage, setStage] = useState<'password' | 'two_factor'>('password');
  const [method, setMethod] = useState<'totp' | 'backup_code'>('totp');
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });
  const challengeForm = useForm<TwoFactorChallengeInput>({
    resolver: zodResolver(twoFactorChallengeSchema),
    defaultValues: { code: '', trustDevice: false },
  });
  const submit = form.handleSubmit(async input => {
    setFailure(null);
    try {
      const result = await signIn(input);
      if (result.data.state === 'two_factor_required') {
        setMethod(result.data.methods.includes('totp') ? 'totp' : 'backup_code');
        setStage('two_factor');
        challengeForm.reset({ code: '', trustDevice: false });
        return;
      }
      onComplete();
    } catch {
      setFailure('The email or password could not be verified.');
    }
  });
  const verifyChallenge = challengeForm.handleSubmit(async input => {
    setFailure(null);
    try {
      if (method === 'totp') {
        await verifySignInTotp(input);
      } else {
        await verifySignInBackupCode(input);
      }
      onComplete();
    } catch {
      setFailure(
        method === 'totp'
          ? 'The authenticator code could not be verified.'
          : 'The recovery code could not be verified.'
      );
    }
  });
  const restart = () => {
    setFailure(null);
    setStage('password');
    setMethod('totp');
    challengeForm.reset({ code: '', trustDevice: false });
  };
  const signInWithPasskey = async () => {
    if (
      typeof window === 'undefined' ||
      !canUsePasskeys({
        secureContext: window.isSecureContext,
        publicKeyCredential: typeof window.PublicKeyCredential !== 'undefined',
      })
    ) {
      setFailure('Passkey sign-in requires HTTPS and WebAuthn browser support.');
      return;
    }
    setFailure(null);
    setPasskeySubmitting(true);
    try {
      const options = await beginPasskeySignIn();
      const response = await startAuthentication({ optionsJSON: options.data });
      const { clientExtensionResults: _clientExtensionResults, ...responseBody } = response;
      await completePasskeySignIn(responseBody);
      onComplete();
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : 'The passkey ceremony was cancelled or could not be verified.'
      );
    } finally {
      setPasskeySubmitting(false);
    }
  };

  return (
    <AuthStage
      eyebrow="Restricted workspace"
      title="Return to the control room."
      description="Incidents remain public. Configuration, identities, and delivery controls stay behind this session boundary."
      icon={<ShieldCheck size={29} />}
    >
      {stage === 'password' ? (
        <>
          <div className="auth-form-heading">
            <span className="auth-step">Secure session</span>
            <h2>Sign in</h2>
            <p>
              Passkeys are preferred. Password access remains the recovery path and requires a
              second factor when configured.
            </p>
          </div>
          <div className="admin-form auth-passkey-entry">
            <button
              className="admin-primary-button"
              disabled={passkeySubmitting || form.formState.isSubmitting}
              onClick={() => void signInWithPasskey()}
              type="button"
            >
              <Fingerprint size={17} />
              {passkeySubmitting ? 'Waiting for passkey…' : 'Continue with a passkey'}
            </button>
            <div className="auth-method-divider">
              <span>or use recovery credentials</span>
            </div>
          </div>
          <form onSubmit={submit} className="admin-form">
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              {...form.register('email')}
              error={form.formState.errors.email?.message}
            />
            <Field
              label="Password"
              type="password"
              autoComplete="current-password"
              {...form.register('password')}
              error={form.formState.errors.password?.message}
            />
            {failure ? <p className="admin-form-error">{failure}</p> : null}
            <button
              className="admin-secondary-button"
              disabled={form.formState.isSubmitting}
              type="submit"
            >
              <KeyRound size={17} />
              {form.formState.isSubmitting ? 'Verifying…' : 'Enter workbench'}
            </button>
          </form>
        </>
      ) : (
        <>
          <div className="auth-form-heading">
            <span className="auth-step">Second factor</span>
            <h2>{method === 'totp' ? 'Authenticator code' : 'Recovery code'}</h2>
            <p>
              {method === 'totp'
                ? 'Enter the current six-digit code from your authenticator.'
                : 'Each recovery code can be used once. It is removed immediately after success.'}
            </p>
          </div>
          <form onSubmit={verifyChallenge} className="admin-form">
            <Field
              label={method === 'totp' ? 'Six-digit code' : 'Recovery code'}
              type="text"
              inputMode={method === 'totp' ? 'numeric' : 'text'}
              autoComplete="one-time-code"
              maxLength={method === 'totp' ? 6 : 128}
              {...challengeForm.register('code')}
              error={challengeForm.formState.errors.code?.message}
            />
            <label className="auth-checkbox">
              <input type="checkbox" {...challengeForm.register('trustDevice')} />
              <span>Trust this browser for 30 days</span>
            </label>
            {failure ? <p className="admin-form-error">{failure}</p> : null}
            <button
              className="admin-primary-button"
              disabled={challengeForm.formState.isSubmitting}
              type="submit"
            >
              <ShieldCheck size={17} />
              {challengeForm.formState.isSubmitting ? 'Checking…' : 'Complete sign in'}
            </button>
            <div className="auth-secondary-actions">
              <button
                className="admin-secondary-button"
                onClick={() => {
                  setFailure(null);
                  setMethod(current => (current === 'totp' ? 'backup_code' : 'totp'));
                  challengeForm.reset({ code: '', trustDevice: false });
                }}
                type="button"
              >
                {method === 'totp' ? 'Use a recovery code' : 'Use authenticator code'}
              </button>
              <button className="admin-quiet-button" onClick={restart} type="button">
                <ArrowLeft size={15} /> Start again
              </button>
            </div>
          </form>
        </>
      )}
    </AuthStage>
  );
};

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Fingerprint, KeyRound, ShieldCheck } from 'lucide-react';
import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { createOwner, signIn } from './api';
import { ownerSetupSchema, signInSchema, type OwnerSetupInput, type SignInInput } from './schemas';

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
  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });
  const submit = form.handleSubmit(async input => {
    setFailure(null);
    try {
      await signIn(input);
      onComplete();
    } catch {
      setFailure('The email or password could not be verified.');
    }
  });

  return (
    <AuthStage
      eyebrow="Restricted workspace"
      title="Return to the control room."
      description="Incidents remain public. Configuration, identities, and delivery controls stay behind this session boundary."
      icon={<ShieldCheck size={29} />}
    >
      <div className="auth-form-heading">
        <span className="auth-step">Secure session</span>
        <h2>Sign in</h2>
        <p>
          Password access is the recovery path. Passkey management follows inside the workbench.
        </p>
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
          className="admin-primary-button"
          disabled={form.formState.isSubmitting}
          type="submit"
        >
          <KeyRound size={17} />
          {form.formState.isSubmitting ? 'Verifying…' : 'Enter workbench'}
        </button>
      </form>
    </AuthStage>
  );
};

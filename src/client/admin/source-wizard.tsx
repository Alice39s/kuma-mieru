import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, CheckCircle2, FlaskConical, RadioTower } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  createSource,
  putSourceToken,
  testSource,
  type AdminSession,
  type AdminSource,
} from './api';
import { sourceDraftSchema, type SourceDraftInput } from './schemas';

interface SourceWizardProps {
  session: AdminSession;
  revision: number;
  onCommitted: () => Promise<void>;
}

interface VerifiedDraft {
  source: AdminSource;
  token: string;
  expiresAt: string;
  pages: Array<{ pageId: string; title: string; status: string; serviceCount: number }>;
}

const toSource = (input: SourceDraftInput, secretRef?: string): AdminSource => {
  const common = {
    id: input.id.trim(),
    baseUrl: input.baseUrl.trim(),
    pageIds: input.pageIds
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  };
  if (input.kind === 'uptime-robot') {
    if (!secretRef) throw new Error('UptimeRobot secret storage did not return a reference.');
    return { ...common, kind: input.kind, secretRef };
  }
  return { ...common, kind: input.kind };
};

export const SourceWizard = ({ session, revision, onCommitted }: SourceWizardProps) => {
  const [verified, setVerified] = useState<VerifiedDraft | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const form = useForm<SourceDraftInput>({
    resolver: zodResolver(sourceDraftSchema),
    defaultValues: { id: '', kind: 'uptime-kuma', baseUrl: '', pageIds: 'default', token: '' },
  });
  const selectedKind = form.watch('kind');

  useEffect(() => {
    const subscription = form.watch(() => setVerified(null));
    return () => subscription.unsubscribe();
  }, [form]);

  const verify = form.handleSubmit(async input => {
    setTesting(true);
    try {
      const secretRef =
        input.kind === 'uptime-robot'
          ? (await putSourceToken(session, input.id.trim(), input.token.trim())).data.secretRef
          : undefined;
      const source = toSource(input, secretRef);
      const result = await testSource(session, source);
      setVerified({ source, ...result.data });
      toast.success('Source verified', { description: 'The draft is ready to commit.' });
    } catch (error) {
      toast.error('Connection test failed', {
        description: error instanceof Error ? error.message : 'Review the source details.',
      });
    } finally {
      setTesting(false);
    }
  });

  const commit = async () => {
    if (!verified) return;
    setSaving(true);
    try {
      const result = await createSource(session, {
        expectedRevision: revision,
        source: verified.source,
        testToken: verified.token,
      });
      toast.success(`Revision ${result.data.revision} is active`);
      form.reset({ id: '', kind: 'uptime-kuma', baseUrl: '', pageIds: 'default', token: '' });
      setVerified(null);
      await onCommitted();
    } catch (error) {
      toast.error('Source was not committed', {
        description:
          error instanceof Error ? error.message : 'The active revision may have changed.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="workbench-editor">
      <header className="editor-heading">
        <div>
          <p className="admin-eyebrow">Source wizard</p>
          <h2>Connect a status source</h2>
        </div>
        <span className="revision-chip">Against r{revision}</span>
      </header>
      <div className="wizard-rail" aria-label="Source workflow">
        <span className="is-current">1 · Describe</span>
        <span className={verified ? 'is-complete' : ''}>2 · Verify</span>
        <span>3 · Commit</span>
      </div>
      <form className="admin-form" onSubmit={verify}>
        <div className="admin-form-row">
          <label className="admin-field">
            <span>Source ID</span>
            <input placeholder="primary" {...form.register('id')} />
            {form.formState.errors.id ? <small>{form.formState.errors.id.message}</small> : null}
          </label>
          <label className="admin-field">
            <span>Adapter</span>
            <select
              {...form.register('kind', {
                onChange: event => {
                  if (event.target.value === 'better-stack') form.setValue('pageIds', 'index');
                  if (event.target.value === 'uptime-robot') {
                    form.setValue('baseUrl', 'https://api.uptimerobot.com/v3');
                    form.setValue('pageIds', 'all');
                  }
                },
              })}
            >
              <option value="uptime-kuma">Uptime Kuma public page</option>
              <option value="better-stack">Better Stack public JSON</option>
              <option value="uptime-robot">UptimeRobot v3 API</option>
            </select>
          </label>
        </div>
        {selectedKind === 'uptime-robot' ? (
          <label className="admin-field">
            <span>Read-only API token</span>
            <input
              autoComplete="off"
              placeholder="Stored encrypted; never shown again"
              type="password"
              {...form.register('token')}
            />
            {form.formState.errors.token ? (
              <small>{form.formState.errors.token.message}</small>
            ) : (
              <small>Use a scoped read-only v3 token. It is replaced by an opaque secretRef.</small>
            )}
          </label>
        ) : null}
        <div className="admin-form-row">
          <label className="admin-field">
            <span>Base URL</span>
            <input placeholder="https://status.example.com" {...form.register('baseUrl')} />
            {form.formState.errors.baseUrl ? (
              <small>{form.formState.errors.baseUrl.message}</small>
            ) : null}
          </label>
          <label className="admin-field">
            <span>Page slugs / snapshot keys</span>
            <input placeholder="default, api" {...form.register('pageIds')} />
            {form.formState.errors.pageIds ? (
              <small>{form.formState.errors.pageIds.message}</small>
            ) : null}
          </label>
        </div>
        <button className="admin-secondary-button" disabled={testing} type="submit">
          <FlaskConical size={17} /> {testing ? 'Testing boundary…' : 'Test connection'}
        </button>
      </form>

      {verified ? (
        <div className="verification-result">
          <div className="verification-title">
            <CheckCircle2 size={18} />
            <div>
              <strong>Validated at the trust boundary</strong>
              <span>Token expires {new Date(verified.expiresAt).toLocaleTimeString()}</span>
            </div>
          </div>
          <div className="verification-pages">
            {verified.pages.map(page => (
              <div key={page.pageId}>
                <RadioTower size={16} />
                <span>
                  <strong>{page.title}</strong>
                  <small>
                    {page.pageId} · {page.serviceCount} services · {page.status}
                  </small>
                </span>
              </div>
            ))}
          </div>
          <button className="admin-primary-button" disabled={saving} onClick={commit} type="button">
            {saving ? 'Committing…' : 'Commit new revision'} <ArrowRight size={17} />
          </button>
        </div>
      ) : null}
    </section>
  );
};

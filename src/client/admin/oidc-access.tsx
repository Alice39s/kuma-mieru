import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Link2, RefreshCw, ShieldX, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  configureAdminOidcMapping,
  configureAdminOidcProvider,
  deleteAdminOidcMapping,
  disableAdminOidcProvider,
  getAdminOidcMappings,
  getAdminOidcProvider,
  type AdminOidcMapping,
  type AdminOidcProvider,
  type AdminSession,
  type AdminUser,
} from './api';

const providerSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Enter a provider name.').max(100),
    discoveryUrl: z.url('Enter a valid HTTPS discovery URL.').max(2_048),
    clientId: z.string().trim().min(1, 'Enter the confidential client ID.').max(1_024),
    clientSecret: z.string().max(16_384),
    tokenEndpointAuthMethod: z.enum(['client_secret_basic', 'client_secret_post']),
  })
  .superRefine((input, context) => {
    let protocol: string;
    try {
      protocol = new URL(input.discoveryUrl).protocol;
    } catch {
      return;
    }
    if (protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        path: ['discoveryUrl'],
        message: 'Discovery must use HTTPS.',
      });
    }
  });

type ProviderInput = z.infer<typeof providerSchema>;
type MappingReview = {
  user: AdminUser;
  expectedSubject: string | null;
  subject: string;
  action: 'configure' | 'delete';
};

export const OidcAccess = ({
  session,
  users,
  onSessionsChanged,
}: {
  session: AdminSession;
  users: AdminUser[];
  onSessionsChanged: () => Promise<void>;
}) => {
  const [provider, setProvider] = useState<AdminOidcProvider | null>(null);
  const [mappings, setMappings] = useState<AdminOidcMapping[]>([]);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [disableConfirmation, setDisableConfirmation] = useState('');
  const [mappingReview, setMappingReview] = useState<MappingReview | null>(null);
  const [mappingConfirmation, setMappingConfirmation] = useState('');
  const [mappingSaving, setMappingSaving] = useState(false);
  const form = useForm<ProviderInput>({
    resolver: zodResolver(providerSchema),
    defaultValues: {
      displayName: 'Company SSO',
      discoveryUrl: '',
      clientId: '',
      clientSecret: '',
      tokenEndpointAuthMethod: 'client_secret_basic',
    },
  });

  const mappingByUser = useMemo(
    () => new Map(mappings.map(mapping => [mapping.userId, mapping])),
    [mappings]
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProvider, nextMappings] = await Promise.all([
        getAdminOidcProvider(),
        getAdminOidcMappings(),
      ]);
      setProvider(nextProvider);
      setMappings(nextMappings);
      setMappingDrafts(
        Object.fromEntries(nextMappings.map(mapping => [mapping.userId, mapping.subject]))
      );
      form.reset({
        displayName: nextProvider.displayName ?? 'Company SSO',
        discoveryUrl: nextProvider.discoveryUrl ?? '',
        clientId: nextProvider.clientId ?? '',
        clientSecret: '',
        tokenEndpointAuthMethod: nextProvider.tokenEndpointAuthMethod ?? 'client_secret_basic',
      });
    } catch (error) {
      toast.error('OIDC configuration is unavailable', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const configure = form.handleSubmit(async input => {
    if (!provider) return;
    if (!provider.clientSecretConfigured && !input.clientSecret) {
      form.setError('clientSecret', {
        type: 'manual',
        message: 'Enter the confidential client secret.',
      });
      return;
    }
    setSaving(true);
    try {
      const result = await configureAdminOidcProvider(session, {
        expectedVersion: provider.version,
        displayName: input.displayName,
        discoveryUrl: input.discoveryUrl,
        clientId: input.clientId,
        ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
        tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
      });
      setProvider(result.data);
      form.setValue('clientSecret', '');
      toast.success('OIDC provider activated', {
        description: 'Discovery and endpoint policy passed. Linked users must authenticate again.',
      });
      if (mappingByUser.has(session.userId)) {
        window.location.assign('/admin');
        return;
      }
      await Promise.all([reload(), onSessionsChanged()]);
    } catch (error) {
      toast.error('OIDC provider was not activated', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  });

  const disable = async () => {
    if (!provider?.enabled || disableConfirmation !== 'DISABLE OIDC') return;
    setDisabling(true);
    try {
      const result = await disableAdminOidcProvider(session, provider.version);
      setProvider(result.data);
      setDisableConfirmation('');
      toast.success('OIDC sign-in disabled', {
        description: 'Sessions belonging to mapped users were revoked.',
      });
      if (mappingByUser.has(session.userId)) {
        window.location.assign('/admin');
        return;
      }
      await Promise.all([reload(), onSessionsChanged()]);
    } catch (error) {
      toast.error('OIDC was not disabled', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDisabling(false);
    }
  };

  const openMappingReview = (user: AdminUser) => {
    const current = mappingByUser.get(user.id);
    const subject = (mappingDrafts[user.id] ?? '').trim();
    if (!subject || subject === current?.subject) {
      toast.info(current ? 'Enter a different subject.' : 'Enter the exact OIDC subject.');
      return;
    }
    setMappingConfirmation('');
    setMappingReview({
      user,
      expectedSubject: current?.subject ?? null,
      subject,
      action: 'configure',
    });
  };

  const openMappingDelete = (user: AdminUser) => {
    const current = mappingByUser.get(user.id);
    if (!current) return;
    setMappingConfirmation('');
    setMappingReview({
      user,
      expectedSubject: current.subject,
      subject: current.subject,
      action: 'delete',
    });
  };

  const commitMapping = async () => {
    if (!mappingReview || mappingConfirmation !== mappingReview.user.id) return;
    setMappingSaving(true);
    try {
      if (mappingReview.action === 'delete') {
        await deleteAdminOidcMapping(session, mappingReview.user.id, mappingReview.subject);
        toast.success('OIDC mapping removed');
      } else {
        await configureAdminOidcMapping(session, mappingReview.user.id, {
          expectedSubject: mappingReview.expectedSubject,
          subject: mappingReview.subject,
        });
        toast.success('OIDC subject mapped', {
          description: 'The target user must authenticate again.',
        });
      }
      if (mappingReview.user.id === session.userId) {
        window.location.assign('/admin');
        return;
      }
      setMappingReview(null);
      setMappingConfirmation('');
      await Promise.all([reload(), onSessionsChanged()]);
    } catch (error) {
      toast.error('OIDC mapping was not changed', {
        description: error instanceof Error ? error.message : undefined,
      });
      await reload();
    } finally {
      setMappingSaving(false);
    }
  };

  return (
    <section className="oidc-access-card">
      <header className="access-section-heading">
        <div>
          <p className="admin-eyebrow">Federated access</p>
          <h2>Generic OpenID Connect</h2>
        </div>
        <span className={provider?.enabled ? 'is-enabled' : ''}>
          {provider?.enabled ? 'active' : 'disabled'}
        </span>
      </header>
      <div className="oidc-access-intro">
        <Building2 aria-hidden="true" size={22} />
        <p>
          OIDC never creates users or imports provider roles. An issuer subject must be mapped to an
          existing local principal before it can sign in.
        </p>
        <button
          aria-label="Refresh OIDC configuration"
          className="admin-quiet-button"
          disabled={loading}
          onClick={() => void reload()}
          type="button"
        >
          <RefreshCw aria-hidden="true" className={loading ? 'is-spinning' : ''} size={15} />
          Refresh
        </button>
      </div>
      <div className="oidc-access-grid">
        <form className="admin-form oidc-provider-form" onSubmit={configure}>
          <label className="admin-field">
            <span>Login button label</span>
            <input autoComplete="off" {...form.register('displayName')} />
            {form.formState.errors.displayName ? (
              <small>{form.formState.errors.displayName.message}</small>
            ) : null}
          </label>
          <label className="admin-field">
            <span>Discovery URL</span>
            <input
              autoComplete="url"
              placeholder="https://id.example.com/.well-known/openid-configuration"
              type="url"
              {...form.register('discoveryUrl')}
            />
            {form.formState.errors.discoveryUrl ? (
              <small>{form.formState.errors.discoveryUrl.message}</small>
            ) : (
              <small>Issuer and all endpoints must share this HTTPS origin.</small>
            )}
          </label>
          <label className="admin-field">
            <span>Confidential client ID</span>
            <input autoComplete="off" {...form.register('clientId')} />
            {form.formState.errors.clientId ? (
              <small>{form.formState.errors.clientId.message}</small>
            ) : null}
          </label>
          <label className="admin-field">
            <span>
              {provider?.clientSecretConfigured ? 'Rotate client secret' : 'Client secret'}
            </span>
            <input
              autoComplete="new-password"
              placeholder={provider?.clientSecretConfigured ? 'Leave blank to keep current' : ''}
              type="password"
              {...form.register('clientSecret')}
            />
            {form.formState.errors.clientSecret ? (
              <small>{form.formState.errors.clientSecret.message}</small>
            ) : (
              <small>Write-only, encrypted, and bound to this provider.</small>
            )}
          </label>
          <label className="admin-field">
            <span>Token endpoint authentication</span>
            <select {...form.register('tokenEndpointAuthMethod')}>
              <option value="client_secret_basic">client_secret_basic</option>
              <option value="client_secret_post">client_secret_post</option>
            </select>
          </label>
          <button className="admin-primary-button" disabled={saving || loading} type="submit">
            <Link2 aria-hidden="true" size={16} />
            {saving
              ? 'Validating discovery…'
              : provider?.enabled
                ? 'Validate and update'
                : 'Validate and enable'}
          </button>
        </form>
        <div className="oidc-mapping-ledger">
          <header>
            <div>
              <p className="admin-eyebrow">Explicit identity map</p>
              <h3>Issuer subjects</h3>
            </div>
            <span>{mappings.length}</span>
          </header>
          {users.map(user => {
            const current = mappingByUser.get(user.id);
            return (
              <article key={user.id}>
                <div>
                  <strong>{user.name}</strong>
                  <small>
                    {user.email} · {user.role}
                  </small>
                </div>
                <label className="admin-field">
                  <span>Exact `sub` claim</span>
                  <input
                    autoComplete="off"
                    onChange={event =>
                      setMappingDrafts(drafts => ({
                        ...drafts,
                        [user.id]: event.target.value,
                      }))
                    }
                    value={mappingDrafts[user.id] ?? ''}
                  />
                </label>
                <div className="oidc-mapping-actions">
                  <button
                    className="admin-secondary-button"
                    onClick={() => openMappingReview(user)}
                    type="button"
                  >
                    Review mapping
                  </button>
                  {current ? (
                    <button
                      aria-label={`Remove OIDC mapping for ${user.name}`}
                      className="admin-danger-button"
                      onClick={() => openMappingDelete(user)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={15} />
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
      {provider?.enabled ? (
        <div className="oidc-disable-review">
          <ShieldX aria-hidden="true" size={19} />
          <div>
            <strong>Disable federated sign-in</strong>
            <p>Type `DISABLE OIDC`. Mapped users lose every active session.</p>
          </div>
          <input
            aria-label="OIDC disable confirmation"
            autoComplete="off"
            onChange={event => setDisableConfirmation(event.target.value)}
            value={disableConfirmation}
          />
          <button
            className="admin-danger-button"
            disabled={disabling || disableConfirmation !== 'DISABLE OIDC'}
            onClick={() => void disable()}
            type="button"
          >
            {disabling ? 'Disabling…' : 'Disable'}
          </button>
        </div>
      ) : null}
      {mappingReview ? (
        <div className="access-risk-review oidc-mapping-review" aria-live="polite">
          <Building2 aria-hidden="true" size={22} />
          <div>
            <p className="admin-eyebrow">Identity mapping review</p>
            <h3>
              {mappingReview.action === 'delete' ? 'Remove' : 'Change'} mapping for{' '}
              {mappingReview.user.name}
            </h3>
            <p>
              The exact issuer subject is <code>{mappingReview.subject}</code>. Every active session
              for this local user will be revoked.
            </p>
            <label className="admin-field">
              <span>
                Type <code>{mappingReview.user.id}</code> to confirm
              </span>
              <input
                autoComplete="off"
                onChange={event => setMappingConfirmation(event.target.value)}
                value={mappingConfirmation}
              />
            </label>
            <div className="access-review-actions">
              <button
                className="admin-secondary-button"
                onClick={() => setMappingReview(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className={
                  mappingReview.action === 'delete' ? 'admin-danger-button' : 'admin-primary-button'
                }
                disabled={mappingSaving || mappingConfirmation !== mappingReview.user.id}
                onClick={() => void commitMapping()}
                type="button"
              >
                {mappingSaving ? 'Applying…' : 'Apply and revoke sessions'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

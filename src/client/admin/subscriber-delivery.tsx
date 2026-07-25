import { zodResolver } from '@hookform/resolvers/zod';
import {
  CheckCircle2,
  Clock3,
  MailCheck,
  MailWarning,
  PlugZap,
  RefreshCw,
  RotateCcw,
  ShieldBan,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  activateSmtpConfiguration,
  getSubscriberDeliveryData,
  retryDelivery,
  sendSmtpTestMessage,
  stageSmtpCredentials,
  suppressSubscriber,
  testSmtpConfiguration,
  type AdminDelivery,
  type AdminSession,
  type AdminSmtpCandidate,
} from './api';
import {
  smtpDraftSchema,
  smtpTestMessageSchema,
  type SmtpDraftInput,
  type SmtpTestMessageInput,
} from './schemas';

type DeliveryData = Awaited<ReturnType<typeof getSubscriberDeliveryData>>;

const canRetry = (delivery: AdminDelivery) =>
  (delivery.state === 'failed' || delivery.state === 'dead_letter') &&
  ((delivery.kind === 'subscription_confirmation' &&
    delivery.subscriberState === 'pending_confirmation') ||
    (delivery.kind === 'event_publication' && delivery.subscriberState === 'active'));

export const SubscriberDelivery = ({
  session,
  revision,
  mode,
  onCommitted,
}: {
  session: AdminSession;
  revision: number;
  mode: 'managed' | 'file' | 'compatibility';
  onCommitted: () => Promise<void>;
}) => {
  const [data, setData] = useState<DeliveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [suppressTarget, setSuppressTarget] = useState<string | null>(null);
  const smtpForm = useForm<SmtpDraftInput>({
    resolver: zodResolver(smtpDraftSchema),
    defaultValues: {
      host: '',
      port: 587,
      tls: 'starttls',
      fromName: '',
      fromAddress: '',
      replyTo: '',
      username: '',
      password: '',
    },
  });
  const testMessageForm = useForm<SmtpTestMessageInput>({
    resolver: zodResolver(smtpTestMessageSchema),
    defaultValues: { recipient: '' },
  });
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getSubscriberDeliveryData());
    } catch (error) {
      toast.error('Subscriber delivery data is unavailable', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const configuration = data?.smtp.configuration;
    if (!configuration?.enabled) return;
    smtpForm.reset({
      host: configuration.host ?? '',
      port: configuration.port ?? 587,
      tls: configuration.tls ?? 'starttls',
      fromName: configuration.from?.name ?? '',
      fromAddress: configuration.from?.address ?? '',
      replyTo: configuration.replyTo ?? '',
      username: '',
      password: '',
    });
  }, [data?.smtp.configuration, smtpForm]);

  const retry = async (delivery: AdminDelivery) => {
    if (delivery.state !== 'failed' && delivery.state !== 'dead_letter') return;
    setBusyId(delivery.id);
    try {
      await retryDelivery(session, delivery.id, delivery.state);
      toast.success('Delivery returned to the queue');
      await reload();
    } catch (error) {
      toast.error('Delivery retry was rejected', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  };

  const suppress = async (subscriberId: string) => {
    setBusyId(subscriberId);
    try {
      await suppressSubscriber(session, subscriberId, 'active');
      toast.success('Subscriber suppressed and pending deliveries stopped');
      setSuppressTarget(null);
      await reload();
    } catch (error) {
      toast.error('Subscriber suppression was rejected', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  };

  const configureSmtp = smtpForm.handleSubmit(async input => {
    setBusyId('smtp-config');
    try {
      const credentials =
        input.username && input.password
          ? (
              await stageSmtpCredentials(session, {
                username: input.username,
                password: input.password,
              })
            ).data
          : {};
      const smtp: AdminSmtpCandidate = {
        enabled: true,
        host: input.host,
        port: input.port,
        tls: input.tls,
        from: {
          address: input.fromAddress,
          ...(input.fromName ? { name: input.fromName } : {}),
        },
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        ...credentials,
      };
      const verification = await testSmtpConfiguration(session, smtp);
      await activateSmtpConfiguration(session, {
        expectedRevision: revision,
        smtp,
        testToken: verification.data.token,
      });
      toast.success('SMTP verified and activated');
      await Promise.all([reload(), onCommitted()]);
    } catch (error) {
      toast.error('SMTP configuration was not activated', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  });

  const disableSmtp = async () => {
    setBusyId('smtp-disable');
    try {
      await activateSmtpConfiguration(session, {
        expectedRevision: revision,
        smtp: { enabled: false },
      });
      toast.success('SMTP delivery disabled');
      await Promise.all([reload(), onCommitted()]);
    } catch (error) {
      toast.error('SMTP delivery could not be disabled', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  };

  const sendTestMessage = testMessageForm.handleSubmit(async input => {
    setBusyId('smtp-test-message');
    try {
      await sendSmtpTestMessage(session, input.recipient);
      toast.success('SMTP accepted the test message');
    } catch (error) {
      toast.error('Test message failed', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  });

  if (!data) {
    return <div className="workbench-loading">Reading private delivery metadata…</div>;
  }
  const queued = data.deliveries.filter(item =>
    ['queued', 'processing'].includes(item.state)
  ).length;
  const sent = data.deliveries.filter(item => item.state === 'sent').length;
  const attention = data.deliveries.filter(item =>
    ['failed', 'dead_letter'].includes(item.state)
  ).length;
  const suppressed = data.subscribers.filter(item => item.state === 'suppressed').length;

  return (
    <div className="subscriber-delivery-workspace">
      <header className="workbench-page-heading">
        <div>
          <p className="admin-eyebrow">Consent and delivery</p>
          <h1>Subscriber health, without exposing addresses.</h1>
          <p>
            Recipient labels are one-way private fingerprints. This dashboard never returns email
            ciphertext, tokens, message payloads, or SMTP credentials.
          </p>
        </div>
        <button
          className="admin-secondary-button"
          disabled={loading}
          onClick={reload}
          type="button"
        >
          <RefreshCw className={loading ? 'is-spinning' : ''} size={16} /> Refresh
        </button>
      </header>
      <div className="metric-ledger delivery-metrics">
        <article>
          <span>Queued / processing</span>
          <strong>{queued}</strong>
          <small>Asynchronous SMTP work</small>
        </article>
        <article>
          <span>Sent</span>
          <strong>{sent}</strong>
          <small>Transport accepted</small>
        </article>
        <article>
          <span>Needs attention</span>
          <strong>{attention}</strong>
          <small>Failed or dead-letter</small>
        </article>
        <article>
          <span>Suppressed</span>
          <strong>{suppressed}</strong>
          <small>No publication delivery</small>
        </article>
      </div>
      <section className={`smtp-control is-${data.smtp.runtime.state}`}>
        <header>
          <div>
            <p className="admin-eyebrow">Mail transport</p>
            <h2>
              {data.smtp.runtime.state === 'running'
                ? 'SMTP worker is active.'
                : data.smtp.runtime.state === 'failed'
                  ? 'SMTP is configured but failed closed.'
                  : 'SMTP delivery is disabled.'}
            </h2>
            <p>
              {data.smtp.configuration.enabled
                ? `${data.smtp.configuration.host}:${data.smtp.configuration.port} · ${data.smtp.configuration.tls} · credentials ${data.smtp.configuration.authenticated ? 'staged' : 'not required'}`
                : 'Public email subscription remains unavailable until an Owner verifies and activates a transport.'}
              {data.smtp.runtime.lastErrorCode ? ` Error: ${data.smtp.runtime.lastErrorCode}.` : ''}
            </p>
          </div>
          <span className={`delivery-state is-${data.smtp.runtime.state}`}>
            {data.smtp.runtime.state}
          </span>
        </header>
        {session.role === 'owner' && mode === 'managed' ? (
          <div className="smtp-control-grid">
            <form className="admin-form smtp-config-form" onSubmit={configureSmtp}>
              <div className="admin-form-row">
                <label className="admin-field">
                  <span>SMTP host</span>
                  <input autoComplete="off" {...smtpForm.register('host')} />
                  {smtpForm.formState.errors.host ? (
                    <small>{smtpForm.formState.errors.host.message}</small>
                  ) : null}
                </label>
                <label className="admin-field">
                  <span>Port</span>
                  <input type="number" {...smtpForm.register('port', { valueAsNumber: true })} />
                  {smtpForm.formState.errors.port ? (
                    <small>{smtpForm.formState.errors.port.message}</small>
                  ) : null}
                </label>
              </div>
              <label className="admin-field">
                <span>TLS mode</span>
                <select {...smtpForm.register('tls')}>
                  <option value="starttls">STARTTLS · usually port 587</option>
                  <option value="implicit">Implicit TLS · port 465 only</option>
                </select>
              </label>
              <div className="admin-form-row">
                <label className="admin-field">
                  <span>Sender name</span>
                  <input autoComplete="organization" {...smtpForm.register('fromName')} />
                </label>
                <label className="admin-field">
                  <span>Sender address</span>
                  <input autoComplete="email" type="email" {...smtpForm.register('fromAddress')} />
                  {smtpForm.formState.errors.fromAddress ? (
                    <small>{smtpForm.formState.errors.fromAddress.message}</small>
                  ) : null}
                </label>
              </div>
              <label className="admin-field">
                <span>Reply-to · optional</span>
                <input type="email" {...smtpForm.register('replyTo')} />
                {smtpForm.formState.errors.replyTo ? (
                  <small>{smtpForm.formState.errors.replyTo.message}</small>
                ) : null}
              </label>
              <div className="admin-form-row">
                <label className="admin-field">
                  <span>Username · optional</span>
                  <input autoComplete="username" {...smtpForm.register('username')} />
                  {smtpForm.formState.errors.username ? (
                    <small>{smtpForm.formState.errors.username.message}</small>
                  ) : null}
                </label>
                <label className="admin-field">
                  <span>Password · optional</span>
                  <input
                    autoComplete="new-password"
                    type="password"
                    {...smtpForm.register('password')}
                  />
                  {smtpForm.formState.errors.password ? (
                    <small>{smtpForm.formState.errors.password.message}</small>
                  ) : null}
                </label>
              </div>
              <div className="smtp-actions">
                <button
                  className="admin-primary-button"
                  disabled={busyId === 'smtp-config'}
                  type="submit"
                >
                  <PlugZap size={16} />
                  {busyId === 'smtp-config' ? 'Verifying…' : 'Verify and activate'}
                </button>
                {data.smtp.configuration.enabled ? (
                  <button
                    className="admin-secondary-button"
                    disabled={busyId === 'smtp-disable'}
                    onClick={() => void disableSmtp()}
                    type="button"
                  >
                    Disable transport
                  </button>
                ) : null}
              </div>
            </form>
            <form className="smtp-test-form" onSubmit={sendTestMessage}>
              <MailCheck size={22} />
              <div>
                <strong>Send a real test email</strong>
                <p>
                  Uses the active transport. Recipient and SMTP response are never persisted in
                  configuration or audit payloads.
                </p>
              </div>
              <label className="admin-field">
                <span>Test recipient</span>
                <input type="email" {...testMessageForm.register('recipient')} />
                {testMessageForm.formState.errors.recipient ? (
                  <small>{testMessageForm.formState.errors.recipient.message}</small>
                ) : null}
              </label>
              <button
                className="admin-secondary-button"
                disabled={data.smtp.runtime.state !== 'running' || busyId === 'smtp-test-message'}
                type="submit"
              >
                {busyId === 'smtp-test-message' ? 'Sending…' : 'Send test'}
              </button>
            </form>
          </div>
        ) : (
          <p className="smtp-read-only">
            {mode !== 'managed'
              ? 'Edit the structured File Mode configuration and reload after verifying its Secret References.'
              : 'Only an Owner can stage credentials, verify a transport, or send a test message.'}
          </p>
        )}
      </section>
      <div className="delivery-columns">
        <section className="entity-ledger delivery-ledger">
          <header>
            <div>
              <p className="admin-eyebrow">Transactional outbox</p>
              <h2>Recent deliveries</h2>
            </div>
            <span>{data.deliveries.length}</span>
          </header>
          {data.deliveries.length > 0 ? (
            data.deliveries.map(delivery => (
              <article key={delivery.id}>
                <span className="entity-icon">
                  {delivery.state === 'sent' ? (
                    <CheckCircle2 size={18} />
                  ) : delivery.state === 'queued' || delivery.state === 'processing' ? (
                    <Clock3 size={18} />
                  ) : (
                    <MailWarning size={18} />
                  )}
                </span>
                <div>
                  <strong>{delivery.recipient}</strong>
                  <small>
                    {delivery.kind} · {delivery.pageId} · attempt {delivery.attempts}
                  </small>
                  {delivery.lastErrorCode ? (
                    <small className="delivery-error-code">{delivery.lastErrorCode}</small>
                  ) : null}
                </div>
                <div className="delivery-actions">
                  <span className={`delivery-state is-${delivery.state}`}>{delivery.state}</span>
                  {canRetry(delivery) ? (
                    <button
                      disabled={busyId === delivery.id}
                      onClick={() => void retry(delivery)}
                      type="button"
                    >
                      <RotateCcw size={14} /> Retry
                    </button>
                  ) : null}
                </div>
              </article>
            ))
          ) : (
            <div className="editor-empty">
              <strong>No delivery activity yet.</strong>
              <p>Publishing without notification intentionally leaves this ledger unchanged.</p>
            </div>
          )}
        </section>
        <section className="entity-ledger subscriber-ledger">
          <header>
            <div>
              <p className="admin-eyebrow">Double opt-in registry</p>
              <h2>Subscribers</h2>
            </div>
            <span>{data.subscribers.length}</span>
          </header>
          {data.subscribers.length > 0 ? (
            data.subscribers.map(subscriber => (
              <article key={subscriber.id}>
                <span className="entity-icon">
                  {subscriber.state === 'suppressed' ? (
                    <ShieldBan size={18} />
                  ) : (
                    <UsersRound size={18} />
                  )}
                </span>
                <div>
                  <strong>{subscriber.recipient}</strong>
                  <small>
                    {subscriber.scope} · {subscriber.pageId}
                  </small>
                </div>
                <div className="delivery-actions">
                  <span className={`delivery-state is-${subscriber.state}`}>
                    {subscriber.state}
                  </span>
                  {session.role === 'owner' && subscriber.state === 'active' ? (
                    suppressTarget === subscriber.id ? (
                      <div className="inline-confirmation">
                        <button onClick={() => setSuppressTarget(null)} type="button">
                          Cancel
                        </button>
                        <button
                          className="is-danger"
                          disabled={busyId === subscriber.id}
                          onClick={() => void suppress(subscriber.id)}
                          type="button"
                        >
                          Confirm suppress
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setSuppressTarget(subscriber.id)} type="button">
                        <ShieldBan size={14} /> Suppress
                      </button>
                    )
                  ) : null}
                </div>
              </article>
            ))
          ) : (
            <div className="editor-empty">
              <strong>No subscriber record yet.</strong>
              <p>Public email requests appear only after passing abuse controls.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

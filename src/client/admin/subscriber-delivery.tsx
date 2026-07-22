import {
  CheckCircle2,
  Clock3,
  MailWarning,
  RefreshCw,
  RotateCcw,
  ShieldBan,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getSubscriberDeliveryData,
  retryDelivery,
  suppressSubscriber,
  type AdminDelivery,
  type AdminSession,
} from './api';

type DeliveryData = Awaited<ReturnType<typeof getSubscriberDeliveryData>>;

const canRetry = (delivery: AdminDelivery) =>
  (delivery.state === 'failed' || delivery.state === 'dead_letter') &&
  ((delivery.kind === 'subscription_confirmation' &&
    delivery.subscriberState === 'pending_confirmation') ||
    (delivery.kind === 'event_publication' && delivery.subscriberState === 'active'));

export const SubscriberDelivery = ({ session }: { session: AdminSession }) => {
  const [data, setData] = useState<DeliveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [suppressTarget, setSuppressTarget] = useState<string | null>(null);
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

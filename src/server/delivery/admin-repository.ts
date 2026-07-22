import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuditContext } from '../config/managed-config.js';

export type SubscriberState =
  | 'pending_confirmation'
  | 'active'
  | 'unsubscribed'
  | 'suppressed'
  | 'expired';
export type DeliveryState = 'queued' | 'processing' | 'sent' | 'failed' | 'dead_letter';

interface SubscriberRow {
  id: string;
  page_id: string;
  incident_id: string | null;
  scope_key: string;
  component_ids_json: string;
  email_hash: string;
  state: SubscriberState;
  created_at: string;
  confirmed_at: string | null;
  updated_at: string;
}

interface DeliveryRow {
  id: string;
  publication_id: string | null;
  subscription_id: string;
  channel: string;
  kind: string;
  state: DeliveryState;
  attempts: number;
  next_attempt_at: string;
  last_error_code: string | null;
  created_at: string;
  sent_at: string | null;
  page_id: string;
  subscriber_state: SubscriberState;
  email_hash: string;
}

export interface AdminSubscriber {
  id: string;
  pageId: string;
  incidentId: string | null;
  scope: string;
  componentIds: string[];
  recipient: string;
  state: SubscriberState;
  createdAt: string;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface AdminDelivery {
  id: string;
  publicationId: string | null;
  subscriptionId: string;
  pageId: string;
  recipient: string;
  channel: string;
  kind: string;
  state: DeliveryState;
  subscriberState: SubscriberState;
  attempts: number;
  nextAttemptAt: string;
  lastErrorCode: string | null;
  createdAt: string;
  sentAt: string | null;
}

const deliveryAdminError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

const privateRecipient = (emailHash: string) => `private-${emailHash.slice(0, 10)}`;

const parseSubscriber = (row: SubscriberRow): AdminSubscriber => ({
  id: row.id,
  pageId: row.page_id,
  incidentId: row.incident_id,
  scope: row.scope_key,
  componentIds: JSON.parse(row.component_ids_json) as string[],
  recipient: privateRecipient(row.email_hash),
  state: row.state,
  createdAt: row.created_at,
  confirmedAt: row.confirmed_at,
  updatedAt: row.updated_at,
});

const parseDelivery = (row: DeliveryRow): AdminDelivery => ({
  id: row.id,
  publicationId: row.publication_id,
  subscriptionId: row.subscription_id,
  pageId: row.page_id,
  recipient: privateRecipient(row.email_hash),
  channel: row.channel,
  kind: row.kind,
  state: row.state,
  subscriberState: row.subscriber_state,
  attempts: row.attempts,
  nextAttemptAt: row.next_attempt_at,
  lastErrorCode: row.last_error_code,
  createdAt: row.created_at,
  sentAt: row.sent_at,
});

const getAdminSubscriber = (database: Database.Database, subscriberId: string) => {
  const row = database
    .prepare(
      `SELECT id, page_id, incident_id, scope_key, component_ids_json, email_hash,
              state, created_at, confirmed_at, updated_at
       FROM email_subscriptions WHERE id = ?`
    )
    .get(subscriberId) as SubscriberRow | undefined;
  return row ? parseSubscriber(row) : null;
};

const getAdminDelivery = (database: Database.Database, deliveryId: string) => {
  const row = database
    .prepare(
      `SELECT o.id, o.publication_id, o.subscription_id, o.channel, o.kind, o.state,
              o.attempts, o.next_attempt_at, o.last_error_code, o.created_at, o.sent_at,
              s.page_id, s.state AS subscriber_state, s.email_hash
       FROM notification_outbox o
       JOIN email_subscriptions s ON s.id = o.subscription_id
       WHERE o.id = ?`
    )
    .get(deliveryId) as DeliveryRow | undefined;
  return row ? parseDelivery(row) : null;
};

const writeAudit = (
  database: Database.Database,
  audit: AuditContext,
  action: string,
  targetType: 'subscriber' | 'delivery',
  targetId: string,
  before: unknown,
  after: unknown
) => {
  database
    .prepare(
      `INSERT INTO admin_audit
        (id, occurred_at, actor_id, action, target_type, target_id, request_id,
         ip_address, user_agent, result, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?)`
    )
    .run(
      randomUUID(),
      new Date().toISOString(),
      audit.actorId,
      action,
      targetType,
      targetId,
      audit.requestId,
      audit.ipAddress ?? null,
      audit.userAgent ?? null,
      JSON.stringify(before),
      JSON.stringify(after)
    );
};

export const listAdminSubscribers = (
  database: Database.Database,
  limit = 200
): AdminSubscriber[] => {
  const rows = database
    .prepare(
      `SELECT id, page_id, incident_id, scope_key, component_ids_json, email_hash,
              state, created_at, confirmed_at, updated_at
       FROM email_subscriptions ORDER BY updated_at DESC LIMIT ?`
    )
    .all(Math.min(Math.max(limit, 1), 500)) as SubscriberRow[];
  return rows.map(parseSubscriber);
};

export const listAdminDeliveries = (database: Database.Database, limit = 200): AdminDelivery[] => {
  const rows = database
    .prepare(
      `SELECT o.id, o.publication_id, o.subscription_id, o.channel, o.kind, o.state,
              o.attempts, o.next_attempt_at, o.last_error_code, o.created_at, o.sent_at,
              s.page_id, s.state AS subscriber_state, s.email_hash
       FROM notification_outbox o
       JOIN email_subscriptions s ON s.id = o.subscription_id
       ORDER BY o.created_at DESC LIMIT ?`
    )
    .all(Math.min(Math.max(limit, 1), 500)) as DeliveryRow[];
  return rows.map(parseDelivery);
};

export const retryAdminDelivery = (
  database: Database.Database,
  deliveryId: string,
  expectedState: 'failed' | 'dead_letter',
  audit: AuditContext
): AdminDelivery =>
  database.transaction(() => {
    const current = getAdminDelivery(database, deliveryId);
    if (!current) throw deliveryAdminError('delivery_not_found', 'Delivery does not exist');
    if (current.state !== expectedState) {
      throw deliveryAdminError(
        'delivery_state_conflict',
        `Expected ${expectedState}, active state is ${current.state}`
      );
    }
    const eligible =
      (current.kind === 'subscription_confirmation' &&
        current.subscriberState === 'pending_confirmation') ||
      (current.kind === 'event_publication' && current.subscriberState === 'active');
    if (!eligible) {
      throw deliveryAdminError(
        'delivery_recipient_ineligible',
        'Subscriber state does not permit this delivery'
      );
    }
    const nextAttemptAt = new Date().toISOString();
    const update = database
      .prepare(
        `UPDATE notification_outbox
         SET state = 'queued', attempts = 0, next_attempt_at = ?, locked_at = NULL,
             locked_by = NULL, last_error_code = NULL
         WHERE id = ? AND state = ?`
      )
      .run(nextAttemptAt, deliveryId, expectedState);
    if (update.changes !== 1) {
      throw deliveryAdminError('delivery_state_conflict', 'Delivery state changed before retry');
    }
    writeAudit(
      database,
      audit,
      'delivery.retry',
      'delivery',
      deliveryId,
      { state: current.state, attempts: current.attempts },
      { state: 'queued', attempts: 0, nextAttemptAt }
    );
    return getAdminDelivery(database, deliveryId) as AdminDelivery;
  })();

export const suppressAdminSubscriber = (
  database: Database.Database,
  subscriberId: string,
  expectedState: 'active',
  audit: AuditContext
): AdminSubscriber =>
  database.transaction(() => {
    const current = getAdminSubscriber(database, subscriberId);
    if (!current) throw deliveryAdminError('subscriber_not_found', 'Subscriber does not exist');
    if (current.state !== expectedState) {
      throw deliveryAdminError(
        'subscriber_state_conflict',
        `Expected ${expectedState}, active state is ${current.state}`
      );
    }
    const updatedAt = new Date().toISOString();
    const update = database
      .prepare(
        `UPDATE email_subscriptions SET state = 'suppressed', updated_at = ?
         WHERE id = ? AND state = 'active'`
      )
      .run(updatedAt, subscriberId);
    if (update.changes !== 1) {
      throw deliveryAdminError(
        'subscriber_state_conflict',
        'Subscriber state changed before suppression'
      );
    }
    database
      .prepare(
        `UPDATE notification_outbox
         SET state = 'dead_letter', locked_at = NULL, locked_by = NULL,
             last_error_code = 'ADMIN_SUPPRESSED'
         WHERE subscription_id = ? AND kind = 'event_publication'
           AND state IN ('queued', 'failed', 'processing')`
      )
      .run(subscriberId);
    writeAudit(
      database,
      audit,
      'subscriber.suppress',
      'subscriber',
      subscriberId,
      { state: current.state },
      { state: 'suppressed', updatedAt }
    );
    return getAdminSubscriber(database, subscriberId) as AdminSubscriber;
  })();

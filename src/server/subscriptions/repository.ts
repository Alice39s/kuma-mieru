import { randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { PiiProtector } from './crypto.js';
import {
  subscriptionManageSchema,
  subscriptionRequestSchema,
  type SubscriptionManageInput,
  type SubscriptionRequestInput,
} from './schemas.js';

type TokenPurpose = 'confirm' | 'manage' | 'unsubscribe';

interface TokenRow {
  id: string;
  subscription_id: string;
  purpose: TokenPurpose;
  expires_at: string;
  consumed_at: string | null;
  page_id: string;
  incident_id: string | null;
  component_ids_json: string;
  state: 'pending_confirmation' | 'active' | 'unsubscribed' | 'suppressed' | 'expired';
}

export interface SubscriptionTokenView {
  subscriptionId: string;
  purpose: TokenPurpose;
  pageId: string;
  incidentId: string | null;
  componentIds: string[];
  state: TokenRow['state'];
  expiresAt: string;
}

const subscriptionError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

const scopeKey = (incidentId: string | null | undefined, componentIds: string[]) =>
  incidentId
    ? `incident:${incidentId}`
    : componentIds.length > 0
      ? `components:${[...new Set(componentIds)].sort().join(',')}`
      : 'page:*';

const randomToken = () => randomBytes(32).toString('base64url');

const consumeRateLimit = (
  database: Database.Database,
  keyHash: string,
  now: Date,
  maximum: number,
  windowMs: number
) => {
  const bucketStart = new Date(Math.floor(now.valueOf() / windowMs) * windowMs).toISOString();
  const row = database
    .prepare(
      `SELECT request_count FROM public_rate_limits
       WHERE key_hash = ? AND bucket_started_at = ?`
    )
    .get(keyHash, bucketStart) as { request_count: number } | undefined;
  if (row && row.request_count >= maximum) return false;
  database
    .prepare(
      `INSERT INTO public_rate_limits (key_hash, bucket_started_at, request_count)
       VALUES (?, ?, 1)
       ON CONFLICT(key_hash, bucket_started_at)
       DO UPDATE SET request_count = request_count + 1`
    )
    .run(keyHash, bucketStart);
  return true;
};

const insertToken = (
  database: Database.Database,
  protector: PiiProtector,
  subscriptionId: string,
  purpose: TokenPurpose,
  token: string,
  expiresAt: string,
  now: string
) => {
  database
    .prepare(
      `INSERT INTO subscription_tokens
        (id, subscription_id, purpose, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(randomUUID(), subscriptionId, purpose, protector.tokenHash(token), expiresAt, now);
};

export const requestEmailSubscription = (
  database: Database.Database,
  protector: PiiProtector,
  pageId: string,
  rawInput: SubscriptionRequestInput
): { accepted: true } => {
  const input = subscriptionRequestSchema.parse(rawInput);
  const normalizedEmail = protector.normalizeEmail(input.email);
  const emailHash = protector.emailHash(normalizedEmail);
  const components = [...new Set(input.componentIds)].sort();
  const requestedScopeKey = scopeKey(input.incidentId, components);
  const now = new Date();
  return database.transaction(() => {
    const pageAllowed = consumeRateLimit(
      database,
      protector.tokenHash(`rate:page:${pageId}`),
      now,
      30,
      60 * 60_000
    );
    const emailAllowed = consumeRateLimit(
      database,
      protector.tokenHash(`rate:email:${pageId}:${emailHash}`),
      now,
      5,
      60 * 60_000
    );
    if (!pageAllowed || !emailAllowed) return { accepted: true as const };

    const existing = database
      .prepare(
        `SELECT id, state FROM email_subscriptions
         WHERE page_id = ? AND scope_key = ? AND email_hash = ?`
      )
      .get(pageId, requestedScopeKey, emailHash) as
      | { id: string; state: TokenRow['state'] }
      | undefined;
    if (existing?.state === 'active' || existing?.state === 'suppressed') {
      return { accepted: true as const };
    }

    const subscriptionId = existing?.id ?? randomUUID();
    const recordedAt = now.toISOString();
    if (existing) {
      database
        .prepare(
          `UPDATE email_subscriptions
           SET incident_id = ?, component_ids_json = ?, email_ciphertext = ?,
               state = 'pending_confirmation', confirmed_at = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.incidentId ?? null,
          JSON.stringify(components),
          protector.encrypt(normalizedEmail),
          recordedAt,
          subscriptionId
        );
      database
        .prepare('DELETE FROM subscription_tokens WHERE subscription_id = ?')
        .run(subscriptionId);
    } else {
      database
        .prepare(
          `INSERT INTO email_subscriptions
            (id, page_id, incident_id, scope_key, component_ids_json, email_hash,
             email_ciphertext, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_confirmation', ?, ?)`
        )
        .run(
          subscriptionId,
          pageId,
          input.incidentId ?? null,
          requestedScopeKey,
          JSON.stringify(components),
          emailHash,
          protector.encrypt(normalizedEmail),
          recordedAt,
          recordedAt
        );
    }

    const confirmToken = randomToken();
    const manageToken = randomToken();
    const unsubscribeToken = randomToken();
    const confirmExpiresAt = new Date(now.valueOf() + 24 * 60 * 60_000).toISOString();
    const manageExpiresAt = new Date(now.valueOf() + 365 * 24 * 60 * 60_000).toISOString();
    insertToken(
      database,
      protector,
      subscriptionId,
      'confirm',
      confirmToken,
      confirmExpiresAt,
      recordedAt
    );
    insertToken(
      database,
      protector,
      subscriptionId,
      'manage',
      manageToken,
      manageExpiresAt,
      recordedAt
    );
    insertToken(
      database,
      protector,
      subscriptionId,
      'unsubscribe',
      unsubscribeToken,
      manageExpiresAt,
      recordedAt
    );
    const payload = protector.encrypt(
      JSON.stringify({
        email: normalizedEmail,
        pageId,
        incidentId: input.incidentId ?? null,
        componentIds: components,
        confirmToken,
        manageToken,
        unsubscribeToken,
        confirmExpiresAt,
      })
    );
    database
      .prepare(
        `INSERT INTO notification_outbox
          (id, publication_id, subscription_id, channel, kind, idempotency_key,
           state, next_attempt_at, payload_ciphertext, created_at)
         VALUES (?, NULL, ?, 'email', 'subscription_confirmation', ?, 'queued', ?, ?, ?)`
      )
      .run(
        randomUUID(),
        subscriptionId,
        `subscription-confirm:${protector.tokenHash(confirmToken)}`,
        recordedAt,
        payload,
        recordedAt
      );
    return { accepted: true as const };
  })();
};

const getTokenRow = (
  database: Database.Database,
  protector: PiiProtector,
  token: string,
  purpose: TokenPurpose
) =>
  database
    .prepare(
      `SELECT t.id, t.subscription_id, t.purpose, t.expires_at, t.consumed_at,
              s.page_id, s.incident_id, s.component_ids_json, s.state
       FROM subscription_tokens t
       JOIN email_subscriptions s ON s.id = t.subscription_id
       WHERE t.token_hash = ? AND t.purpose = ?`
    )
    .get(protector.tokenHash(token), purpose) as TokenRow | undefined;

export const inspectSubscriptionToken = (
  database: Database.Database,
  protector: PiiProtector,
  token: string,
  purpose: TokenPurpose
): SubscriptionTokenView | null => {
  const row = getTokenRow(database, protector, token, purpose);
  if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) return null;
  return {
    subscriptionId: row.subscription_id,
    purpose: row.purpose,
    pageId: row.page_id,
    incidentId: row.incident_id,
    componentIds: JSON.parse(row.component_ids_json) as string[],
    state: row.state,
    expiresAt: row.expires_at,
  };
};

export const confirmEmailSubscription = (
  database: Database.Database,
  protector: PiiProtector,
  token: string
): SubscriptionTokenView =>
  database.transaction(() => {
    const view = inspectSubscriptionToken(database, protector, token, 'confirm');
    if (!view || view.state !== 'pending_confirmation') {
      throw subscriptionError('subscription_token_invalid', 'Confirmation token is invalid');
    }
    const now = new Date().toISOString();
    database
      .prepare(
        `UPDATE subscription_tokens SET consumed_at = ?
         WHERE token_hash = ? AND consumed_at IS NULL`
      )
      .run(now, protector.tokenHash(token));
    database
      .prepare(
        `UPDATE email_subscriptions
         SET state = 'active', confirmed_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(now, now, view.subscriptionId);
    return { ...view, state: 'active' as const };
  })();

export const updateEmailSubscription = (
  database: Database.Database,
  protector: PiiProtector,
  token: string,
  rawInput: SubscriptionManageInput
): SubscriptionTokenView => {
  const input = subscriptionManageSchema.parse(rawInput);
  return database.transaction(() => {
    const view = inspectSubscriptionToken(database, protector, token, 'manage');
    if (!view || view.state !== 'active') {
      throw subscriptionError('subscription_token_invalid', 'Management token is invalid');
    }
    const components = [...new Set(input.componentIds)].sort();
    const incidentId = input.incidentId ?? null;
    database
      .prepare(
        `UPDATE email_subscriptions
         SET incident_id = ?, scope_key = ?, component_ids_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        incidentId,
        scopeKey(incidentId, components),
        JSON.stringify(components),
        new Date().toISOString(),
        view.subscriptionId
      );
    return { ...view, incidentId, componentIds: components };
  })();
};

export const unsubscribeEmail = (
  database: Database.Database,
  protector: PiiProtector,
  token: string
) =>
  database.transaction(() => {
    const view = inspectSubscriptionToken(database, protector, token, 'unsubscribe');
    if (!view || view.state !== 'active') {
      throw subscriptionError('subscription_token_invalid', 'Unsubscribe token is invalid');
    }
    const now = new Date().toISOString();
    database
      .prepare('UPDATE subscription_tokens SET consumed_at = ? WHERE token_hash = ?')
      .run(now, protector.tokenHash(token));
    database
      .prepare("UPDATE email_subscriptions SET state = 'unsubscribed', updated_at = ? WHERE id = ?")
      .run(now, view.subscriptionId);
    database
      .prepare(
        `UPDATE notification_outbox
         SET state = 'failed', last_error_code = 'SUBSCRIPTION_UNSUBSCRIBED'
         WHERE subscription_id = ? AND state = 'queued' AND kind = 'event_publication'`
      )
      .run(view.subscriptionId);
    return { unsubscribed: true as const };
  })();

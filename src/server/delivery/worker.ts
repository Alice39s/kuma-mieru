import type Database from 'better-sqlite3';
import type { PiiProtector } from '../subscriptions/crypto.js';
import type { PublicationSnapshot } from '../events/schemas.js';
import type { EmailDeliveryTransport, EmailMessage } from './transport.js';

interface OutboxRow {
  id: string;
  publication_id: string | null;
  subscription_id: string;
  kind: 'subscription_confirmation' | 'event_publication';
  attempts: number;
  payload_ciphertext: string;
  email_ciphertext: string;
  publication_json: string | null;
}

interface DeliveryError extends Error {
  code?: string;
  command?: string;
  responseCode?: number;
  statusCode?: number;
}

export interface DeliveryWorkerOptions {
  database: Database.Database;
  protector: PiiProtector;
  transport: EmailDeliveryTransport;
  publicBaseUrl: string;
  workerId?: string;
  maximumAttempts?: number;
  now?: () => Date;
}

const claimOutboxItem = (
  database: Database.Database,
  workerId: string,
  now: Date
): OutboxRow | null =>
  database.transaction(() => {
    const nowIso = now.toISOString();
    const staleLock = new Date(now.valueOf() - 5 * 60_000).toISOString();
    const candidate = database
      .prepare(
        `SELECT id FROM notification_outbox
         WHERE (
           (state IN ('queued', 'failed') AND next_attempt_at <= ?)
           OR (state = 'processing' AND locked_at < ?)
         )
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(nowIso, staleLock) as { id: string } | undefined;
    if (!candidate) return null;
    database
      .prepare(
        `UPDATE notification_outbox
         SET state = 'processing', attempts = attempts + 1, locked_at = ?, locked_by = ?
         WHERE id = ?`
      )
      .run(nowIso, workerId, candidate.id);
    return database
      .prepare(
        `SELECT o.id, o.publication_id, o.subscription_id, o.kind, o.attempts,
                o.payload_ciphertext, s.email_ciphertext,
                p.content_json AS publication_json
         FROM notification_outbox o
         JOIN email_subscriptions s ON s.id = o.subscription_id
         LEFT JOIN event_publications p ON p.id = o.publication_id
         WHERE o.id = ?`
      )
      .get(candidate.id) as OutboxRow;
  })();

const messageIdFor = (outboxId: string, publicBaseUrl: string) =>
  `<${outboxId}@${new URL(publicBaseUrl).hostname}>`;

const materializeMessage = (
  row: OutboxRow,
  protector: PiiProtector,
  publicBaseUrl: string
): EmailMessage => {
  const payload = JSON.parse(protector.decrypt(row.payload_ciphertext)) as Record<string, unknown>;
  const email = protector.decrypt(row.email_ciphertext);
  const baseUrl = new URL(publicBaseUrl);
  if (row.kind === 'subscription_confirmation') {
    const confirmToken = String(payload.confirmToken);
    const confirmationUrl = new URL(
      `/api/v1/public/subscriptions/confirm/${encodeURIComponent(confirmToken)}`,
      baseUrl
    ).toString();
    return {
      to: email,
      subject: 'Confirm your status-page subscription',
      text: `Confirm this subscription with the following link:\n\n${confirmationUrl}\n\nOpening the link only previews the request. Confirmation requires the explicit action on that page.`,
      messageId: messageIdFor(row.id, publicBaseUrl),
    };
  }

  if (!row.publication_json) throw new Error('Event publication payload is missing');
  const publication = JSON.parse(row.publication_json) as PublicationSnapshot;
  const manageUrl = new URL(
    `/api/v1/public/subscriptions/manage/${encodeURIComponent(String(payload.manageToken))}`,
    baseUrl
  ).toString();
  const unsubscribeUrl = new URL(
    `/api/v1/public/subscriptions/unsubscribe/${encodeURIComponent(String(payload.unsubscribeToken))}`,
    baseUrl
  ).toString();
  const incidentUrl = new URL(
    `/status/${encodeURIComponent(publication.pageId)}/incidents/${encodeURIComponent(publication.eventId)}/`,
    baseUrl
  ).toString();
  return {
    to: email,
    subject: `${publication.title} — ${publication.state}`,
    text: `${publication.body}\n\nStatus: ${publication.state}\nOccurred: ${publication.occurredAt}\nPublished: ${publication.publishedAt}\n\nView incident: ${incidentUrl}\nManage subscription: ${manageUrl}\nUnsubscribe: ${unsubscribeUrl}`,
    messageId: messageIdFor(row.id, publicBaseUrl),
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
};

const classifyFailure = (error: DeliveryError) => {
  const responseCode = error.responseCode ?? error.statusCode;
  const permanent =
    error.code === 'EAUTH' ||
    error.code === 'ECONFIG' ||
    (responseCode !== undefined && responseCode >= 500 && responseCode < 600);
  const suppressRecipient =
    responseCode !== undefined &&
    responseCode >= 500 &&
    responseCode < 600 &&
    (error.code === 'EENVELOPE' || error.command?.toUpperCase().includes('RCPT') === true);
  return {
    permanent,
    suppressRecipient,
    code: error.code ?? (responseCode ? `SMTP_${responseCode}` : 'DELIVERY_FAILED'),
  };
};

const failOutboxItem = (
  database: Database.Database,
  row: OutboxRow,
  error: DeliveryError,
  now: Date,
  maximumAttempts: number
) => {
  const failure = classifyFailure(error);
  const deadLetter = failure.permanent || row.attempts >= maximumAttempts;
  const delayMs = Math.min(60 * 60_000, 60_000 * 2 ** Math.max(row.attempts - 1, 0));
  database.transaction(() => {
    database
      .prepare(
        `UPDATE notification_outbox
         SET state = ?, next_attempt_at = ?, locked_at = NULL, locked_by = NULL,
             last_error_code = ?
         WHERE id = ?`
      )
      .run(
        deadLetter ? 'dead_letter' : 'failed',
        new Date(now.valueOf() + delayMs).toISOString(),
        failure.code.slice(0, 200),
        row.id
      );
    if (failure.suppressRecipient) {
      database
        .prepare(
          `UPDATE email_subscriptions
           SET state = 'suppressed', updated_at = ? WHERE id = ? AND state = 'active'`
        )
        .run(now.toISOString(), row.subscription_id);
    }
  })();
};

export const processDeliveryBatch = async (
  options: DeliveryWorkerOptions,
  batchSize = 25
): Promise<{ processed: number; sent: number; failed: number }> => {
  const workerId = options.workerId ?? `worker-${process.pid}`;
  const maximumAttempts = options.maximumAttempts ?? 8;
  const clock = options.now ?? (() => new Date());
  let processed = 0;
  let sent = 0;
  let failed = 0;
  while (processed < Math.min(Math.max(batchSize, 1), 100)) {
    const now = clock();
    const row = claimOutboxItem(options.database, workerId, now);
    if (!row) break;
    processed += 1;
    try {
      const message = materializeMessage(row, options.protector, options.publicBaseUrl);
      await options.transport.send(message);
      options.database
        .prepare(
          `UPDATE notification_outbox
           SET state = 'sent', sent_at = ?, locked_at = NULL, locked_by = NULL,
               last_error_code = NULL
           WHERE id = ?`
        )
        .run(now.toISOString(), row.id);
      sent += 1;
    } catch (error) {
      failOutboxItem(
        options.database,
        row,
        error instanceof Error ? (error as DeliveryError) : new Error('Delivery failed'),
        now,
        maximumAttempts
      );
      failed += 1;
    }
  }
  return { processed, sent, failed };
};

export const startDeliveryWorker = (
  options: DeliveryWorkerOptions,
  input: { intervalMs?: number; batchSize?: number } = {}
) => {
  const intervalMs = Math.max(input.intervalMs ?? 5_000, 250);
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await processDeliveryBatch(options, input.batchSize);
    } catch (error) {
      console.error('Delivery worker batch failed', {
        message: error instanceof Error ? error.message : 'Unknown delivery failure',
      });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
    options.transport.close();
  };
};

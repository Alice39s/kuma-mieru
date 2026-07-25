import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import { defaultRetentionPolicy, type RetentionPolicy } from '../config/schema.js';
import type { SubscriberTombstoneStore } from './tombstone-store.js';

const dayMs = 24 * 60 * 60 * 1000;
const policyVersion = 1;
const batchSize = 250;

export type RetentionRunTrigger = 'admin' | 'scheduler' | 'restore';

export interface RetentionCutoffs {
  eventDraftBefore: string;
  adminAuditBefore: string;
  deliveryAttemptBefore: string;
  backupBefore: string;
  pendingConfirmationBefore: string;
  abuseHashBefore: string;
  expiredTokenBefore: string;
}

export interface RetentionSummary {
  subscriberTombstonesApplied: number;
  pendingSubscriptionsExpired: number;
  terminalSubscriptionsRedacted: number;
  terminalDeliveryPayloadsRedacted: number;
  expiredSubscriptionTokensDeleted: number;
  deliveryAttemptsDeleted: number;
  abuseRateLimitBucketsDeleted: number;
  unpublishedTerminalEventsDeleted: number;
  adminAuditRowsDeleted: number;
  backupArtifactsMarkedEligible: number;
  backupArtifactsMarkedCurrent: number;
}

export interface RetentionPreview {
  policyVersion: number;
  policy: RetentionPolicy;
  cutoffs: RetentionCutoffs;
  candidates: Omit<RetentionSummary, 'subscriberTombstonesApplied'>;
}

export interface RetentionRun {
  id: string;
  trigger: RetentionRunTrigger;
  actorId: string;
  state: 'running' | 'completed' | 'failed';
  policyVersion: number;
  cutoffs: RetentionCutoffs;
  summary: RetentionSummary | null;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface RetentionService {
  preview(): RetentionPreview;
  run(trigger: RetentionRunTrigger, actorId: string): Promise<RetentionRun>;
  list(limit?: number): RetentionRun[];
}

const emptySummary = (): RetentionSummary => ({
  subscriberTombstonesApplied: 0,
  pendingSubscriptionsExpired: 0,
  terminalSubscriptionsRedacted: 0,
  terminalDeliveryPayloadsRedacted: 0,
  expiredSubscriptionTokensDeleted: 0,
  deliveryAttemptsDeleted: 0,
  abuseRateLimitBucketsDeleted: 0,
  unpublishedTerminalEventsDeleted: 0,
  adminAuditRowsDeleted: 0,
  backupArtifactsMarkedEligible: 0,
  backupArtifactsMarkedCurrent: 0,
});

const retentionError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

export const retentionErrorCode = (error: unknown) =>
  typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'retention_failed';

const cutoff = (now: Date, days: number) => new Date(now.valueOf() - days * dayMs).toISOString();

export const retentionCutoffs = (
  now: Date,
  policy: RetentionPolicy = defaultRetentionPolicy
): RetentionCutoffs => ({
  eventDraftBefore: cutoff(now, policy.eventDraftDays),
  adminAuditBefore: cutoff(now, policy.adminAuditDays),
  deliveryAttemptBefore: cutoff(now, policy.deliveryAttemptDays),
  backupBefore: cutoff(now, policy.backupDays),
  pendingConfirmationBefore: cutoff(now, 7),
  abuseHashBefore: cutoff(now, 30),
  expiredTokenBefore: cutoff(now, 7),
});

const count = (database: Database.Database, sql: string, ...parameters: Array<string | number>) =>
  (
    database.prepare(sql).get(...parameters) as {
      count: number;
    }
  ).count;

const terminalEventPredicate = `
  (
    (type = 'incident' AND state = 'resolved')
    OR (type = 'maintenance' AND state IN ('completed', 'cancelled'))
    OR (type = 'notice' AND state IN ('expired', 'withdrawn'))
  )
  AND updated_at < ?
  AND NOT EXISTS (
    SELECT 1 FROM event_publications publication
    WHERE publication.event_id = native_events.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM native_events child
    WHERE child.parent_event_id = native_events.id
  )
`;

const previewCandidates = (
  database: Database.Database,
  cutoffs: RetentionCutoffs
): RetentionPreview['candidates'] => ({
  pendingSubscriptionsExpired: count(
    database,
    `SELECT COUNT(*) AS count FROM email_subscriptions subscription
     WHERE state = 'pending_confirmation' AND updated_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM notification_outbox outbox
         WHERE outbox.subscription_id = subscription.id AND outbox.state = 'processing'
       )
       AND NOT EXISTS (
         SELECT 1 FROM subscription_tokens token
         WHERE token.subscription_id = subscription.id
           AND token.purpose = 'confirm' AND token.consumed_at IS NULL
           AND token.expires_at > ?
       )`,
    cutoffs.pendingConfirmationBefore,
    cutoffs.pendingConfirmationBefore
  ),
  terminalSubscriptionsRedacted: count(
    database,
    `SELECT COUNT(*) AS count FROM email_subscriptions
     WHERE state IN ('unsubscribed', 'suppressed', 'expired')
       AND (email_ciphertext != '' OR pii_deleted_at IS NULL)`
  ),
  terminalDeliveryPayloadsRedacted: count(
    database,
    `SELECT COUNT(*) AS count FROM notification_outbox outbox
     JOIN email_subscriptions subscription ON subscription.id = outbox.subscription_id
     WHERE subscription.state IN ('unsubscribed', 'suppressed', 'expired')
       AND outbox.payload_ciphertext IS NOT NULL AND outbox.state != 'processing'`
  ),
  expiredSubscriptionTokensDeleted: count(
    database,
    'SELECT COUNT(*) AS count FROM subscription_tokens WHERE expires_at < ?',
    cutoffs.expiredTokenBefore
  ),
  deliveryAttemptsDeleted: count(
    database,
    `SELECT COUNT(*) AS count FROM notification_outbox
     WHERE state IN ('sent', 'failed', 'dead_letter') AND created_at < ?`,
    cutoffs.deliveryAttemptBefore
  ),
  abuseRateLimitBucketsDeleted: count(
    database,
    'SELECT COUNT(*) AS count FROM public_rate_limits WHERE bucket_started_at < ?',
    cutoffs.abuseHashBefore
  ),
  unpublishedTerminalEventsDeleted: count(
    database,
    `SELECT COUNT(*) AS count FROM native_events WHERE ${terminalEventPredicate}`,
    cutoffs.eventDraftBefore
  ),
  adminAuditRowsDeleted: count(
    database,
    'SELECT COUNT(*) AS count FROM admin_audit WHERE occurred_at < ?',
    cutoffs.adminAuditBefore
  ),
  backupArtifactsMarkedEligible: count(
    database,
    `SELECT COUNT(*) AS count FROM backup_artifacts
     WHERE retention_state = 'current' AND created_at < ? AND state != 'creating'`,
    cutoffs.backupBefore
  ),
  backupArtifactsMarkedCurrent: count(
    database,
    `SELECT COUNT(*) AS count FROM backup_artifacts
     WHERE retention_state = 'eligible' AND created_at >= ?`,
    cutoffs.backupBefore
  ),
});

const selectIds = (database: Database.Database, sql: string, parameters: Array<string | number>) =>
  database.prepare(sql).all(...parameters, batchSize) as Array<{ id: string }>;

const mutateBatches = async ({
  database,
  selectSql,
  selectParameters,
  mutateSql,
  mutateParameters = [],
}: {
  database: Database.Database;
  selectSql: string;
  selectParameters: Array<string | number>;
  mutateSql: string;
  mutateParameters?: Array<string | number>;
}) => {
  let changed = 0;
  const mutate = database.prepare(mutateSql);
  while (true) {
    const ids = selectIds(database, selectSql, selectParameters);
    if (ids.length === 0) return changed;
    changed += database.transaction(() => {
      let batchChanged = 0;
      for (const { id } of ids) {
        batchChanged += mutate.run(...mutateParameters, id).changes;
      }
      return batchChanged;
    })();
    await setImmediate();
  }
};

const deleteRateLimitBatches = async (database: Database.Database, before: string) => {
  const select = database.prepare(
    `SELECT key_hash, bucket_started_at FROM public_rate_limits
     WHERE bucket_started_at < ?
     ORDER BY bucket_started_at, key_hash LIMIT ?`
  );
  const remove = database.prepare(
    'DELETE FROM public_rate_limits WHERE key_hash = ? AND bucket_started_at = ?'
  );
  let changed = 0;
  while (true) {
    const rows = select.all(before, batchSize) as Array<{
      key_hash: string;
      bucket_started_at: string;
    }>;
    if (rows.length === 0) return changed;
    changed += database.transaction(() => {
      let batchChanged = 0;
      for (const row of rows) {
        batchChanged += remove.run(row.key_hash, row.bucket_started_at).changes;
      }
      return batchChanged;
    })();
    await setImmediate();
  }
};

const mapRun = (row: {
  id: string;
  run_trigger: RetentionRunTrigger;
  actor_id: string;
  state: RetentionRun['state'];
  policy_version: number;
  cutoffs_json: string;
  summary_json: string | null;
  error_code: string | null;
  started_at: string;
  completed_at: string | null;
}): RetentionRun => ({
  id: row.id,
  trigger: row.run_trigger,
  actorId: row.actor_id,
  state: row.state,
  policyVersion: row.policy_version,
  cutoffs: JSON.parse(row.cutoffs_json) as RetentionCutoffs,
  summary: row.summary_json ? (JSON.parse(row.summary_json) as RetentionSummary) : null,
  errorCode: row.error_code,
  startedAt: row.started_at,
  completedAt: row.completed_at,
});

export const createRetentionService = ({
  database,
  policy = () => defaultRetentionPolicy,
  now = () => new Date(),
  tombstones,
}: {
  database: Database.Database;
  policy?: () => RetentionPolicy;
  now?: () => Date;
  tombstones?: SubscriberTombstoneStore;
}): RetentionService => {
  let running = false;
  database
    .prepare(
      `UPDATE retention_runs
       SET state = 'failed', error_code = 'retention_interrupted', completed_at = ?
       WHERE state = 'running'`
    )
    .run(now().toISOString());

  const preview = (): RetentionPreview => {
    const activePolicy = policy();
    const cutoffs = retentionCutoffs(now(), activePolicy);
    return {
      policyVersion,
      policy: activePolicy,
      cutoffs,
      candidates: previewCandidates(database, cutoffs),
    };
  };

  const list = (limit = 50) =>
    (
      database
        .prepare(
          `SELECT id, run_trigger, actor_id, state, policy_version, cutoffs_json, summary_json,
                  error_code, started_at, completed_at
           FROM retention_runs ORDER BY started_at DESC LIMIT ?`
        )
        .all(Math.min(Math.max(limit, 1), 200)) as Array<Parameters<typeof mapRun>[0]>
    ).map(mapRun);

  const run = async (trigger: RetentionRunTrigger, actorId: string) => {
    if (running) throw retentionError('retention_in_progress', 'A retention run is already active');
    running = true;
    const activePolicy = policy();
    const started = now();
    const startedAt = started.toISOString();
    const cutoffs = retentionCutoffs(started, activePolicy);
    const id = `ret_${randomUUID()}`;
    const summary = emptySummary();
    try {
      try {
        database
          .prepare(
            `INSERT INTO retention_runs
              (id, policy_version, run_trigger, actor_id, state, cutoffs_json, started_at)
             VALUES (?, ?, ?, ?, 'running', ?, ?)`
          )
          .run(id, policyVersion, trigger, actorId, JSON.stringify(cutoffs), startedAt);
      } catch (error) {
        if (String(error).includes('retention_runs_one_running_idx')) {
          throw retentionError('retention_in_progress', 'A retention run is already active');
        }
        throw error;
      }

      summary.subscriberTombstonesApplied = tombstones?.apply(database) ?? 0;
      summary.pendingSubscriptionsExpired = await mutateBatches({
        database,
        selectSql: `SELECT id FROM email_subscriptions subscription
          WHERE state = 'pending_confirmation' AND updated_at < ?
            AND NOT EXISTS (
              SELECT 1 FROM notification_outbox outbox
              WHERE outbox.subscription_id = subscription.id AND outbox.state = 'processing'
            )
            AND NOT EXISTS (
              SELECT 1 FROM subscription_tokens token
              WHERE token.subscription_id = subscription.id
                AND token.purpose = 'confirm' AND token.consumed_at IS NULL
                AND token.expires_at > ?
            )
          ORDER BY updated_at, id LIMIT ?`,
        selectParameters: [cutoffs.pendingConfirmationBefore, cutoffs.pendingConfirmationBefore],
        mutateSql: `UPDATE email_subscriptions
          SET state = 'expired', email_ciphertext = '', pii_deleted_at = ?
          WHERE id = ? AND state = 'pending_confirmation'`,
        mutateParameters: [startedAt],
      });
      summary.terminalSubscriptionsRedacted = await mutateBatches({
        database,
        selectSql: `SELECT id FROM email_subscriptions
          WHERE state IN ('unsubscribed', 'suppressed', 'expired')
            AND (email_ciphertext != '' OR pii_deleted_at IS NULL)
          ORDER BY updated_at, id LIMIT ?`,
        selectParameters: [],
        mutateSql: `UPDATE email_subscriptions
          SET email_ciphertext = '', pii_deleted_at = COALESCE(pii_deleted_at, ?)
          WHERE id = ?`,
        mutateParameters: [startedAt],
      });
      summary.terminalDeliveryPayloadsRedacted = await mutateBatches({
        database,
        selectSql: `SELECT outbox.id FROM notification_outbox outbox
          JOIN email_subscriptions subscription ON subscription.id = outbox.subscription_id
          WHERE subscription.state IN ('unsubscribed', 'suppressed', 'expired')
            AND outbox.payload_ciphertext IS NOT NULL AND outbox.state != 'processing'
          ORDER BY outbox.created_at, outbox.id LIMIT ?`,
        selectParameters: [],
        mutateSql: `UPDATE notification_outbox
          SET state = CASE WHEN state IN ('queued', 'failed') THEN 'dead_letter' ELSE state END,
              payload_ciphertext = NULL,
              locked_at = NULL,
              locked_by = NULL,
              last_error_code = CASE
                WHEN state IN ('queued', 'failed') THEN 'SUBSCRIPTION_RETAINED_MINIMAL'
                ELSE last_error_code
              END
          WHERE id = ? AND state != 'processing'`,
      });
      summary.expiredSubscriptionTokensDeleted = await mutateBatches({
        database,
        selectSql:
          'SELECT id FROM subscription_tokens WHERE expires_at < ? ORDER BY expires_at, id LIMIT ?',
        selectParameters: [cutoffs.expiredTokenBefore],
        mutateSql: 'DELETE FROM subscription_tokens WHERE id = ?',
      });
      summary.deliveryAttemptsDeleted = await mutateBatches({
        database,
        selectSql: `SELECT id FROM notification_outbox
          WHERE state IN ('sent', 'failed', 'dead_letter') AND created_at < ?
          ORDER BY created_at, id LIMIT ?`,
        selectParameters: [cutoffs.deliveryAttemptBefore],
        mutateSql: 'DELETE FROM notification_outbox WHERE id = ?',
      });
      summary.abuseRateLimitBucketsDeleted = await deleteRateLimitBatches(
        database,
        cutoffs.abuseHashBefore
      );
      summary.unpublishedTerminalEventsDeleted = await mutateBatches({
        database,
        selectSql: `SELECT id FROM native_events
          WHERE ${terminalEventPredicate}
          ORDER BY updated_at, id LIMIT ?`,
        selectParameters: [cutoffs.eventDraftBefore],
        mutateSql: 'DELETE FROM native_events WHERE id = ?',
      });
      summary.adminAuditRowsDeleted = await mutateBatches({
        database,
        selectSql:
          'SELECT id FROM admin_audit WHERE occurred_at < ? ORDER BY occurred_at, id LIMIT ?',
        selectParameters: [cutoffs.adminAuditBefore],
        mutateSql: 'DELETE FROM admin_audit WHERE id = ?',
      });
      summary.backupArtifactsMarkedEligible = database
        .prepare(
          `UPDATE backup_artifacts
           SET retention_state = 'eligible', retention_decided_at = ?
           WHERE retention_state = 'current' AND created_at < ? AND state != 'creating'`
        )
        .run(startedAt, cutoffs.backupBefore).changes;
      summary.backupArtifactsMarkedCurrent = database
        .prepare(
          `UPDATE backup_artifacts
           SET retention_state = 'current', retention_decided_at = ?
           WHERE retention_state = 'eligible' AND created_at >= ?`
        )
        .run(startedAt, cutoffs.backupBefore).changes;

      const completedAt = now().toISOString();
      database
        .prepare(
          `UPDATE retention_runs
           SET state = 'completed', summary_json = ?, completed_at = ?
           WHERE id = ? AND state = 'running'`
        )
        .run(JSON.stringify(summary), completedAt, id);
      return mapRun({
        id,
        run_trigger: trigger,
        actor_id: actorId,
        state: 'completed',
        policy_version: policyVersion,
        cutoffs_json: JSON.stringify(cutoffs),
        summary_json: JSON.stringify(summary),
        error_code: null,
        started_at: startedAt,
        completed_at: completedAt,
      });
    } catch (error) {
      const code = retentionErrorCode(error);
      const completedAt = now().toISOString();
      database
        .prepare(
          `UPDATE retention_runs
           SET state = 'failed', summary_json = ?, error_code = ?, completed_at = ?
           WHERE id = ? AND state = 'running'`
        )
        .run(JSON.stringify(summary), code, completedAt, id);
      throw error;
    } finally {
      running = false;
    }
  };

  return { preview, run, list };
};

const retentionScheduleIntervalMs = 60 * 60 * 1000;
const retentionScheduleMaximumAgeMs = 24 * 60 * 60 * 1000;

export const runRetentionScheduleOnce = async ({
  service,
  now = () => new Date(),
}: {
  service: RetentionService;
  now?: () => Date;
}) => {
  const latest = service.list(1)[0];
  if (
    latest?.state === 'completed' &&
    latest.completedAt &&
    now().valueOf() - Date.parse(latest.completedAt) < retentionScheduleMaximumAgeMs
  ) {
    return 'current' as const;
  }
  await service.run('scheduler', 'system:retention-scheduler');
  return 'executed' as const;
};

export const startRetentionScheduler = ({
  service,
  onError = error =>
    console.error('Scheduled retention failed', { code: retentionErrorCode(error) }),
}: {
  service: RetentionService;
  onError?: (error: unknown) => void;
}) => {
  const execute = () => void runRetentionScheduleOnce({ service }).catch(onError);
  const startupTimer = setTimeout(execute, 120_000);
  const interval = setInterval(execute, retentionScheduleIntervalMs);
  startupTimer.unref();
  interval.unref();
  return () => {
    clearTimeout(startupTimer);
    clearInterval(interval);
  };
};

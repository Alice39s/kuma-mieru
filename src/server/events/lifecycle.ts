import { performance } from 'node:perf_hooks';
import type Database from 'better-sqlite3';
import {
  appendMaintenanceUpdate,
  getMaintenance,
  getMaintenancePublicationReview,
  publishMaintenance,
} from './maintenance-repository.js';
import {
  appendNoticeUpdate,
  getNotice,
  getNoticePublicationReview,
  publishNotice,
} from './notice-repository.js';

const systemActor = 'system:event-lifecycle';
const defaultBatchSize = 100;
const maximumBackfillBatchSize = 250;
const defaultBackfillBatchSize = maximumBackfillBatchSize;
const defaultIntervalMilliseconds = 30_000;

interface DueEventRow {
  id: string;
  type: 'maintenance' | 'notice';
  state: 'scheduled' | 'in_progress' | 'published';
  version: number;
  lifecycle_due_at: string;
}

interface LegacyLifecycleBackfillRow {
  id: string;
  lifecycle_due_at: string | null;
}

export interface EventLifecycleFailure {
  eventId: string;
  code: string;
}

export interface EventLifecycleRun {
  evaluatedAt: string;
  dueEvents: number;
  transitionedEvents: number;
  transitions: number;
  publications: number;
  hasMore: boolean;
  failures: EventLifecycleFailure[];
}

export interface EventLifecycleService {
  run(): EventLifecycleRun;
}

export interface EventLifecycleBackfillRun {
  batchSize: number;
  batches: number;
  updatedEvents: number;
  maxWriteLockMilliseconds: number;
  totalWriteLockMilliseconds: number;
}

export const eventLifecycleErrorCode = (error: unknown) =>
  typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'event_lifecycle_failed';

const lifecycleError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

export const backfillEventLifecycleDueTimes = ({
  database,
  batchSize = defaultBackfillBatchSize,
}: {
  database: Database.Database;
  batchSize?: number;
}): EventLifecycleBackfillRun => {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > maximumBackfillBatchSize) {
    throw lifecycleError(
      'event_lifecycle_backfill_batch_invalid',
      `Event lifecycle backfill batch size must be between 1 and ${maximumBackfillBatchSize}`
    );
  }
  const selectBatchSql = (cursorPredicate: string) =>
    `SELECT id,
       CASE
         WHEN type = 'maintenance' AND state = 'scheduled'
           THEN strftime(
             '%Y-%m-%dT%H:%M:%fZ',
             json_extract(details_json, '$.scheduledStartAt')
           )
         WHEN type = 'maintenance' AND state = 'in_progress'
           THEN strftime(
             '%Y-%m-%dT%H:%M:%fZ',
             json_extract(details_json, '$.scheduledEndAt')
           )
         WHEN type = 'notice' AND state = 'published'
           THEN strftime(
             '%Y-%m-%dT%H:%M:%fZ',
             json_extract(details_json, '$.endsAt')
           )
         ELSE NULL
       END AS lifecycle_due_at
     FROM native_events
     WHERE lifecycle_due_at IS NULL
       AND (
         (type = 'maintenance' AND state IN ('scheduled', 'in_progress'))
         OR (type = 'notice' AND state = 'published')
       )
       ${cursorPredicate}
     ORDER BY id
     LIMIT ?`;
  const selectFirstBatch = database.prepare(selectBatchSql(''));
  const selectNextBatch = database.prepare(selectBatchSql('AND id > ?'));
  const updateEvent = database.prepare(
    `UPDATE native_events
     SET lifecycle_due_at = ?
     WHERE id = ? AND lifecycle_due_at IS NULL`
  );
  const applyBatch = database.transaction(
    (rows: Array<{ id: string; lifecycle_due_at: string }>) => {
      for (const row of rows) {
        const result = updateEvent.run(row.lifecycle_due_at, row.id);
        if (result.changes !== 1) {
          throw lifecycleError(
            'event_lifecycle_backfill_conflict',
            `Event lifecycle backfill lost ownership of ${row.id}`
          );
        }
      }
    }
  );

  let batches = 0;
  let updatedEvents = 0;
  let maxWriteLockMilliseconds = 0;
  let totalWriteLockMilliseconds = 0;
  let cursor: string | null = null;
  while (true) {
    let rows: LegacyLifecycleBackfillRow[];
    try {
      rows =
        cursor === null
          ? (selectFirstBatch.all(batchSize) as LegacyLifecycleBackfillRow[])
          : (selectNextBatch.all(cursor, batchSize) as LegacyLifecycleBackfillRow[]);
    } catch {
      throw lifecycleError(
        'event_lifecycle_backfill_invalid',
        'Legacy event lifecycle details are not valid JSON'
      );
    }
    if (rows.length === 0) break;
    const validRows = rows.map(row => {
      if (
        typeof row.id !== 'string' ||
        row.id.length === 0 ||
        typeof row.lifecycle_due_at !== 'string' ||
        Number.isNaN(Date.parse(row.lifecycle_due_at))
      ) {
        throw lifecycleError(
          'event_lifecycle_backfill_invalid',
          `Legacy event ${row.id} has no valid lifecycle boundary`
        );
      }
      return { id: row.id, lifecycle_due_at: row.lifecycle_due_at };
    });
    const nextCursor = validRows.at(-1)?.id;
    if (!nextCursor) {
      throw lifecycleError(
        'event_lifecycle_backfill_invalid',
        'Legacy event lifecycle batch has no valid cursor'
      );
    }
    const startedAt = performance.now();
    applyBatch(validRows);
    const writeLockMilliseconds = performance.now() - startedAt;
    batches += 1;
    updatedEvents += validRows.length;
    totalWriteLockMilliseconds += writeLockMilliseconds;
    maxWriteLockMilliseconds = Math.max(maxWriteLockMilliseconds, writeLockMilliseconds);
    cursor = nextCursor;
  }
  return {
    batchSize,
    batches,
    updatedEvents,
    maxWriteLockMilliseconds,
    totalWriteLockMilliseconds,
  };
};

const auditContext = (eventId: string, nextVersion: number) => ({
  actorId: systemActor,
  requestId: `event-lifecycle:${eventId}:${nextVersion}`,
});

const currentVersionIsPublished = (database: Database.Database, eventId: string, version: number) =>
  Boolean(
    database
      .prepare(
        `SELECT 1 FROM event_publications
         WHERE event_id = ? AND event_sequence = ?`
      )
      .get(eventId, version)
  );

const advanceMaintenance = (database: Database.Database, row: DueEventRow, evaluatedAt: Date) => {
  let maintenance = getMaintenance(database, row.id);
  if (!maintenance) {
    throw lifecycleError('event_lifecycle_missing', 'Due maintenance no longer exists');
  }
  if (maintenance.version !== row.version || maintenance.state !== row.state) {
    return 0;
  }
  if (!currentVersionIsPublished(database, maintenance.id, maintenance.version)) {
    return 0;
  }

  let transitions = 0;
  for (let step = 0; step < 2; step += 1) {
    const isStarting =
      maintenance.state === 'scheduled' &&
      Date.parse(maintenance.scheduledStartAt) <= evaluatedAt.valueOf();
    const isCompleting =
      maintenance.state === 'in_progress' &&
      Date.parse(maintenance.scheduledEndAt) <= evaluatedAt.valueOf();
    if (!isStarting && !isCompleting) break;

    const nextState = isStarting ? ('in_progress' as const) : ('completed' as const);
    const occurredAt = isStarting ? maintenance.scheduledStartAt : maintenance.scheduledEndAt;
    const body = isStarting
      ? 'Scheduled maintenance is now in progress.'
      : 'Scheduled maintenance completed.';
    const next = appendMaintenanceUpdate(
      database,
      maintenance.id,
      {
        expectedVersion: maintenance.version,
        state: nextState,
        body,
        occurredAt,
      },
      auditContext(maintenance.id, maintenance.version + 1)
    );
    const review = getMaintenancePublicationReview(database, next.id, next.version);
    publishMaintenance(
      database,
      {
        eventId: next.id,
        expectedVersion: next.version,
        notifySubscribers: false,
        expectedRecipients: review.estimatedRecipients,
      },
      auditContext(next.id, next.version)
    );
    maintenance = next;
    transitions += 1;
  }
  return transitions;
};

const advanceNotice = (database: Database.Database, row: DueEventRow, evaluatedAt: Date) => {
  const notice = getNotice(database, row.id);
  if (!notice) throw lifecycleError('event_lifecycle_missing', 'Due notice no longer exists');
  if (notice.version !== row.version || notice.state !== row.state) return 0;
  if (!currentVersionIsPublished(database, notice.id, notice.version)) return 0;
  if (
    notice.state !== 'published' ||
    !notice.endsAt ||
    Date.parse(notice.endsAt) > evaluatedAt.valueOf()
  ) {
    return 0;
  }

  const next = appendNoticeUpdate(
    database,
    notice.id,
    {
      expectedVersion: notice.version,
      state: 'expired',
      body: 'This notice reached its configured end time.',
      occurredAt: notice.endsAt,
    },
    auditContext(notice.id, notice.version + 1)
  );
  const review = getNoticePublicationReview(database, next.id, next.version);
  publishNotice(
    database,
    {
      eventId: next.id,
      expectedVersion: next.version,
      notifySubscribers: false,
      expectedRecipients: review.estimatedRecipients,
    },
    auditContext(next.id, next.version)
  );
  return 1;
};

export const createEventLifecycleService = ({
  database,
  now = () => new Date(),
  batchSize = defaultBatchSize,
}: {
  database: Database.Database;
  now?: () => Date;
  batchSize?: number;
}): EventLifecycleService => {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw lifecycleError(
      'event_lifecycle_batch_invalid',
      'Event lifecycle batch size must be between 1 and 1000'
    );
  }

  const advance = database.transaction((row: DueEventRow, evaluatedAt: Date) =>
    row.type === 'maintenance'
      ? advanceMaintenance(database, row, evaluatedAt)
      : advanceNotice(database, row, evaluatedAt)
  );

  const run = (): EventLifecycleRun => {
    const evaluatedAt = now();
    if (Number.isNaN(evaluatedAt.valueOf())) {
      throw lifecycleError('event_lifecycle_clock_invalid', 'Event lifecycle clock is invalid');
    }
    const normalizedNow = evaluatedAt.toISOString();
    const rows = database
      .prepare(
        `SELECT event.id, event.type, event.state, event.version, event.lifecycle_due_at
         FROM native_events AS event
         INNER JOIN event_publications AS publication
           ON publication.event_id = event.id
          AND publication.event_sequence = event.version
         WHERE event.lifecycle_due_at IS NOT NULL
           AND event.lifecycle_due_at <= ?
           AND (
             (event.type = 'maintenance' AND event.state IN ('scheduled', 'in_progress'))
             OR (event.type = 'notice' AND event.state = 'published')
           )
         ORDER BY event.lifecycle_due_at ASC, event.id ASC
         LIMIT ?`
      )
      .all(normalizedNow, batchSize) as DueEventRow[];

    let transitionedEvents = 0;
    let transitions = 0;
    const failures: EventLifecycleFailure[] = [];
    for (const row of rows) {
      try {
        const count = advance(row, evaluatedAt);
        if (count > 0) transitionedEvents += 1;
        transitions += count;
      } catch (error) {
        failures.push({ eventId: row.id, code: eventLifecycleErrorCode(error) });
      }
    }
    return {
      evaluatedAt: normalizedNow,
      dueEvents: rows.length,
      transitionedEvents,
      transitions,
      publications: transitions,
      hasMore: rows.length === batchSize,
      failures,
    };
  };

  return { run };
};

export const startEventLifecycleScheduler = ({
  service,
  intervalMilliseconds = defaultIntervalMilliseconds,
  onRun,
  onError = error =>
    console.error('Scheduled event lifecycle failed', {
      code: eventLifecycleErrorCode(error),
    }),
}: {
  service: EventLifecycleService;
  intervalMilliseconds?: number;
  onRun?: (result: EventLifecycleRun) => void;
  onError?: (error: unknown) => void;
}) => {
  if (
    !Number.isInteger(intervalMilliseconds) ||
    intervalMilliseconds < 1_000 ||
    intervalMilliseconds > 60 * 60_000
  ) {
    throw lifecycleError(
      'event_lifecycle_interval_invalid',
      'Event lifecycle interval must be between 1 second and 1 hour'
    );
  }
  const execute = () => {
    try {
      const result = service.run();
      onRun?.(result);
      if (result.failures.length > 0) {
        onError(
          lifecycleError(
            'event_lifecycle_partial',
            `${result.failures.length} event lifecycle transitions failed`
          )
        );
      }
    } catch (error) {
      onError(error);
    }
  };
  const interval = setInterval(execute, intervalMilliseconds);
  interval.unref();
  return () => clearInterval(interval);
};

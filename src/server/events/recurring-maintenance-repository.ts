import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuditContext } from '../config/managed-config.js';
import {
  createMaintenance,
  getMaintenance,
  type MaintenanceRecord,
} from './maintenance-repository.js';
import {
  recurringMaintenancePlanCreateSchema,
  recurringMaintenancePlanUpdateSchema,
  type RecurringMaintenanceFrequency,
  type RecurringMaintenancePlanCreateInput,
  type RecurringMaintenancePlanState,
  type RecurringMaintenancePlanUpdateInput,
} from './recurring-maintenance-schemas.js';
import { eventError, hashInput } from './repository.js';

const millisecondsPerMinute = 60_000;
const millisecondsPerDay = 24 * 60 * millisecondsPerMinute;
const defaultHorizonDays = 35;
const maximumHorizonDays = 90;
const defaultOccurrenceLimit = 100;
const maximumOccurrenceLimit = 100;
const systemActor = 'system:recurring-maintenance';

interface RecurringMaintenancePlanRow {
  id: string;
  page_id: string;
  name: string;
  state: RecurringMaintenancePlanState;
  version: number;
  created_by: string;
  request_hash: string;
  next_occurrence_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RecurringMaintenancePlanEntryRow {
  sequence: number;
  state: RecurringMaintenancePlanState;
  name: string;
  title: string;
  body: string;
  affected_components_json: string;
  frequency: RecurringMaintenanceFrequency;
  interval_count: number;
  weekdays_json: string;
  anchor_start_at: string;
  duration_minutes: number;
  recurrence_end_at: string | null;
  recorded_at: string;
  actor_id: string;
}

interface RecurringMaintenanceOccurrenceRow {
  id: string;
  plan_id: string;
  plan_version: number;
  event_id: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  materialized_at: string;
}

export interface RecurringMaintenanceSchedule {
  timeBasis: 'utc';
  frequency: RecurringMaintenanceFrequency;
  interval: number;
  weekdays: number[];
  anchorStartAt: string;
  durationMinutes: number;
  endsAt: string | null;
}

export interface RecurringMaintenancePlanRecord {
  id: string;
  pageId: string;
  name: string;
  state: RecurringMaintenancePlanState;
  version: number;
  title: string;
  body: string;
  affectedComponentIds: string[];
  schedule: RecurringMaintenanceSchedule;
  nextOccurrenceAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  latestEntry: {
    sequence: number;
    state: RecurringMaintenancePlanState;
    name: string;
    title: string;
    body: string;
    affectedComponentIds: string[];
    schedule: RecurringMaintenanceSchedule;
    recordedAt: string;
    actorId: string;
  };
}

export interface RecurringMaintenanceOccurrenceRecord {
  id: string;
  planId: string;
  planVersion: number;
  eventId: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  materializedAt: string;
  maintenance: MaintenanceRecord;
}

export interface RecurringMaintenanceMaterialization {
  planId: string;
  planVersion: number;
  evaluatedAt: string;
  horizonAt: string;
  materializedOccurrences: number;
  existingOccurrences: number;
  nextOccurrenceAt: string | null;
  hasMore: boolean;
}

const planColumns = `
  id, page_id, name, state, version, created_by, request_hash,
  next_occurrence_at, created_at, updated_at`;

const normalizeDateTime = (value: string) => new Date(value).toISOString();

const normalizeCreateInput = (
  input: RecurringMaintenancePlanCreateInput
): RecurringMaintenancePlanCreateInput => ({
  ...input,
  weekdays: [...input.weekdays].sort((left, right) => left - right),
  anchorStartAt: normalizeDateTime(input.anchorStartAt),
  endsAt: input.endsAt ? normalizeDateTime(input.endsAt) : null,
});

const normalizeUpdateInput = (
  input: RecurringMaintenancePlanUpdateInput
): RecurringMaintenancePlanUpdateInput => ({
  ...input,
  weekdays: [...input.weekdays].sort((left, right) => left - right),
  anchorStartAt: normalizeDateTime(input.anchorStartAt),
  endsAt: input.endsAt ? normalizeDateTime(input.endsAt) : null,
});

const scheduleFromInput = (
  input: RecurringMaintenancePlanCreateInput | RecurringMaintenancePlanUpdateInput
): RecurringMaintenanceSchedule => ({
  timeBasis: 'utc',
  frequency: input.frequency,
  interval: input.interval,
  weekdays: input.weekdays,
  anchorStartAt: input.anchorStartAt,
  durationMinutes: input.durationMinutes,
  endsAt: input.endsAt,
});

const utcWeekday = (timestamp: number) => {
  const day = new Date(timestamp).getUTCDay();
  return day === 0 ? 7 : day;
};

const utcDayStart = (timestamp: number) => {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const validateClock = (date: Date, code: string, message: string) => {
  if (Number.isNaN(date.valueOf())) throw eventError(code, message);
  return date;
};

export const nextRecurringOccurrenceAt = (
  schedule: RecurringMaintenanceSchedule,
  notBefore: Date
): string | null => {
  const lowerBound = validateClock(
    notBefore,
    'recurring_maintenance_clock_invalid',
    'Recurring maintenance clock is invalid'
  ).valueOf();
  const anchor = Date.parse(schedule.anchorStartAt);
  const recurrenceEnd = schedule.endsAt ? Date.parse(schedule.endsAt) : null;
  let candidate: number;

  if (schedule.frequency === 'daily') {
    const step = schedule.interval * millisecondsPerDay;
    const steps = Math.max(0, Math.ceil((lowerBound - anchor) / step));
    candidate = anchor + steps * step;
  } else {
    const anchorDay = utcDayStart(anchor);
    const anchorWeekStart = anchorDay - (utcWeekday(anchor) - 1) * millisecondsPerDay;
    const anchorTimeOfDay = anchor - anchorDay;
    const searchStart = Math.max(lowerBound, anchor);
    const firstSearchDay = utcDayStart(searchStart);
    const maximumSearchDays = schedule.interval * 7 + 7;
    candidate = Number.NaN;
    for (let offset = 0; offset <= maximumSearchDays; offset += 1) {
      const day = firstSearchDay + offset * millisecondsPerDay;
      const possible = day + anchorTimeOfDay;
      if (possible < searchStart) continue;
      const week = Math.floor((day - anchorWeekStart) / (7 * millisecondsPerDay));
      if (
        week >= 0 &&
        week % schedule.interval === 0 &&
        schedule.weekdays.includes(utcWeekday(possible))
      ) {
        candidate = possible;
        break;
      }
    }
    if (Number.isNaN(candidate)) {
      throw eventError(
        'recurring_maintenance_schedule_invalid',
        'Recurring maintenance schedule has no bounded next occurrence'
      );
    }
  }

  if (recurrenceEnd !== null && candidate > recurrenceEnd) return null;
  return new Date(candidate).toISOString();
};

const getPlanEntry = (
  database: Database.Database,
  planId: string,
  sequence: number
): RecurringMaintenancePlanRecord['latestEntry'] => {
  const row = database
    .prepare(
      `SELECT sequence, state, name, title, body, affected_components_json,
              frequency, interval_count, weekdays_json, anchor_start_at,
              duration_minutes, recurrence_end_at, recorded_at, actor_id
       FROM recurring_maintenance_plan_entries
       WHERE plan_id = ? AND sequence = ?`
    )
    .get(planId, sequence) as RecurringMaintenancePlanEntryRow | undefined;
  if (!row) {
    throw eventError(
      'recurring_maintenance_entry_missing',
      'Recurring maintenance plan entry is missing'
    );
  }
  const parsed = recurringMaintenancePlanUpdateSchema.parse({
    expectedVersion: row.sequence,
    state: row.state,
    name: row.name,
    title: row.title,
    body: row.body,
    affectedComponentIds: JSON.parse(row.affected_components_json),
    timeBasis: 'utc',
    frequency: row.frequency,
    interval: row.interval_count,
    weekdays: JSON.parse(row.weekdays_json),
    anchorStartAt: row.anchor_start_at,
    durationMinutes: row.duration_minutes,
    endsAt: row.recurrence_end_at,
  });
  const normalized = normalizeUpdateInput(parsed);
  return {
    sequence: row.sequence,
    state: normalized.state,
    name: normalized.name,
    title: normalized.title,
    body: normalized.body,
    affectedComponentIds: normalized.affectedComponentIds,
    schedule: scheduleFromInput(normalized),
    recordedAt: row.recorded_at,
    actorId: row.actor_id,
  };
};

const parsePlan = (
  database: Database.Database,
  row: RecurringMaintenancePlanRow
): RecurringMaintenancePlanRecord => {
  const latestEntry = getPlanEntry(database, row.id, row.version);
  return {
    id: row.id,
    pageId: row.page_id,
    name: row.name,
    state: row.state,
    version: row.version,
    title: latestEntry.title,
    body: latestEntry.body,
    affectedComponentIds: latestEntry.affectedComponentIds,
    schedule: latestEntry.schedule,
    nextOccurrenceAt: row.next_occurrence_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestEntry,
  };
};

export const getRecurringMaintenancePlan = (
  database: Database.Database,
  planId: string
): RecurringMaintenancePlanRecord | null => {
  const row = database
    .prepare(`SELECT ${planColumns} FROM recurring_maintenance_plans WHERE id = ?`)
    .get(planId) as RecurringMaintenancePlanRow | undefined;
  return row ? parsePlan(database, row) : null;
};

export const listRecurringMaintenancePlans = (
  database: Database.Database,
  state?: RecurringMaintenancePlanState,
  limit = 100
): RecurringMaintenancePlanRecord[] => {
  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  const rows = (
    state
      ? database
          .prepare(
            `SELECT ${planColumns} FROM recurring_maintenance_plans
             WHERE state = ? ORDER BY updated_at DESC, id ASC LIMIT ?`
          )
          .all(state, boundedLimit)
      : database
          .prepare(
            `SELECT ${planColumns} FROM recurring_maintenance_plans
             ORDER BY updated_at DESC, id ASC LIMIT ?`
          )
          .all(boundedLimit)
  ) as RecurringMaintenancePlanRow[];
  return rows.map(row => parsePlan(database, row));
};

const planNameOwner = (database: Database.Database, name: string): { id: string } | undefined =>
  database
    .prepare('SELECT id FROM recurring_maintenance_plans WHERE name = ? COLLATE NOCASE')
    .get(name) as { id: string } | undefined;

const writePlanAudit = (
  database: Database.Database,
  audit: AuditContext,
  action: string,
  plan: RecurringMaintenancePlanRecord,
  extra: Record<string, unknown> = {}
) => {
  database
    .prepare(
      `INSERT INTO admin_audit
        (id, occurred_at, actor_id, action, target_type, target_id, request_id,
         ip_address, user_agent, result, after_json)
       VALUES (?, ?, ?, ?, 'recurring_maintenance_plan', ?, ?, ?, ?, 'success', ?)`
    )
    .run(
      randomUUID(),
      new Date().toISOString(),
      audit.actorId,
      action,
      plan.id,
      audit.requestId,
      audit.ipAddress ?? null,
      audit.userAgent ?? null,
      JSON.stringify({
        state: plan.state,
        version: plan.version,
        nextOccurrenceAt: plan.nextOccurrenceAt,
        ...extra,
      })
    );
};

const insertPlanEntry = (
  database: Database.Database,
  planId: string,
  sequence: number,
  input: RecurringMaintenancePlanCreateInput | RecurringMaintenancePlanUpdateInput,
  recordedAt: string,
  actorId: string
) => {
  database
    .prepare(
      `INSERT INTO recurring_maintenance_plan_entries
        (id, plan_id, sequence, state, name, title, body, affected_components_json,
         frequency, interval_count, weekdays_json, anchor_start_at, duration_minutes,
         recurrence_end_at, recorded_at, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      planId,
      sequence,
      input.state,
      input.name,
      input.title,
      input.body,
      JSON.stringify(input.affectedComponentIds),
      input.frequency,
      input.interval,
      JSON.stringify(input.weekdays),
      input.anchorStartAt,
      input.durationMinutes,
      input.endsAt,
      recordedAt,
      actorId
    );
};

export const createRecurringMaintenancePlan = (
  database: Database.Database,
  rawInput: RecurringMaintenancePlanCreateInput,
  idempotencyKey: string,
  audit: AuditContext,
  now = () => new Date()
): RecurringMaintenancePlanRecord => {
  const input = normalizeCreateInput(recurringMaintenancePlanCreateSchema.parse(rawInput));
  const requestHash = hashInput(input);
  return database.transaction(() => {
    const existing = database
      .prepare(
        `SELECT ${planColumns} FROM recurring_maintenance_plans
         WHERE created_by = ? AND idempotency_key = ?`
      )
      .get(audit.actorId, idempotencyKey) as RecurringMaintenancePlanRow | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw eventError(
          'idempotency_key_reused',
          'Idempotency key was already used for another request'
        );
      }
      return parsePlan(database, existing);
    }
    if (planNameOwner(database, input.name)) {
      throw eventError(
        'recurring_maintenance_name_conflict',
        'Recurring maintenance plan name is already in use'
      );
    }

    const evaluatedAt = validateClock(
      now(),
      'recurring_maintenance_clock_invalid',
      'Recurring maintenance clock is invalid'
    );
    const id = randomUUID();
    const recordedAt = evaluatedAt.toISOString();
    const nextOccurrenceAt = nextRecurringOccurrenceAt(scheduleFromInput(input), evaluatedAt);
    database
      .prepare(
        `INSERT INTO recurring_maintenance_plans
          (id, page_id, name, state, version, created_by, idempotency_key,
           request_hash, next_occurrence_at, created_at, updated_at)
         VALUES (?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.pageId,
        input.name,
        audit.actorId,
        idempotencyKey,
        requestHash,
        nextOccurrenceAt,
        recordedAt,
        recordedAt
      );
    insertPlanEntry(database, id, 1, input, recordedAt, audit.actorId);
    const created = getRecurringMaintenancePlan(database, id) as RecurringMaintenancePlanRecord;
    writePlanAudit(database, audit, 'recurring_maintenance.create', created);
    return created;
  })();
};

const allowedPlanTransitions: Record<
  RecurringMaintenancePlanState,
  RecurringMaintenancePlanState[]
> = {
  active: ['active', 'paused', 'archived'],
  paused: ['active', 'paused', 'archived'],
  archived: ['archived'],
};

export const appendRecurringMaintenancePlanUpdate = (
  database: Database.Database,
  planId: string,
  rawInput: RecurringMaintenancePlanUpdateInput,
  audit: AuditContext,
  now = () => new Date()
): RecurringMaintenancePlanRecord => {
  const input = normalizeUpdateInput(recurringMaintenancePlanUpdateSchema.parse(rawInput));
  return database.transaction(() => {
    const current = getRecurringMaintenancePlan(database, planId);
    if (!current) {
      throw eventError(
        'recurring_maintenance_not_found',
        'Recurring maintenance plan does not exist'
      );
    }
    if (current.version !== input.expectedVersion) {
      throw eventError(
        'recurring_maintenance_version_conflict',
        `Expected version ${input.expectedVersion}, active version is ${current.version}`
      );
    }
    if (!allowedPlanTransitions[current.state].includes(input.state)) {
      throw eventError(
        'invalid_recurring_maintenance_transition',
        `Cannot transition recurring maintenance from ${current.state} to ${input.state}`
      );
    }
    const owner = planNameOwner(database, input.name);
    if (owner && owner.id !== planId) {
      throw eventError(
        'recurring_maintenance_name_conflict',
        'Recurring maintenance plan name is already in use'
      );
    }

    const evaluatedAt = validateClock(
      now(),
      'recurring_maintenance_clock_invalid',
      'Recurring maintenance clock is invalid'
    );
    const version = current.version + 1;
    const recordedAt = evaluatedAt.toISOString();
    const nextOccurrenceAt =
      input.state === 'active'
        ? nextRecurringOccurrenceAt(scheduleFromInput(input), evaluatedAt)
        : null;
    insertPlanEntry(database, planId, version, input, recordedAt, audit.actorId);
    database
      .prepare(
        `UPDATE recurring_maintenance_plans
         SET name = ?, state = ?, version = ?, next_occurrence_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(input.name, input.state, version, nextOccurrenceAt, recordedAt, planId);
    const updated = getRecurringMaintenancePlan(database, planId) as RecurringMaintenancePlanRecord;
    writePlanAudit(database, audit, 'recurring_maintenance.update', updated);
    return updated;
  })();
};

const occurrenceFromRow = (
  database: Database.Database,
  row: RecurringMaintenanceOccurrenceRow
): RecurringMaintenanceOccurrenceRecord => {
  const maintenance = getMaintenance(database, row.event_id);
  if (!maintenance) {
    throw eventError(
      'recurring_maintenance_occurrence_invalid',
      'Recurring maintenance occurrence event is missing'
    );
  }
  return {
    id: row.id,
    planId: row.plan_id,
    planVersion: row.plan_version,
    eventId: row.event_id,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    materializedAt: row.materialized_at,
    maintenance,
  };
};

export const listRecurringMaintenanceOccurrences = (
  database: Database.Database,
  planId: string,
  limit = 100
): RecurringMaintenanceOccurrenceRecord[] => {
  const rows = database
    .prepare(
      `SELECT id, plan_id, plan_version, event_id, scheduled_start_at,
              scheduled_end_at, materialized_at
       FROM recurring_maintenance_occurrences
       WHERE plan_id = ?
       ORDER BY scheduled_start_at DESC
       LIMIT ?`
    )
    .all(planId, Math.min(Math.max(limit, 1), 100)) as RecurringMaintenanceOccurrenceRow[];
  return rows.map(row => occurrenceFromRow(database, row));
};

export const materializeRecurringMaintenancePlan = (
  database: Database.Database,
  planId: string,
  options: {
    expectedVersion?: number;
    now?: () => Date;
    horizonDays?: number;
    occurrenceLimit?: number;
  } = {}
): RecurringMaintenanceMaterialization => {
  const horizonDays = options.horizonDays ?? defaultHorizonDays;
  const occurrenceLimit = options.occurrenceLimit ?? defaultOccurrenceLimit;
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > maximumHorizonDays) {
    throw eventError(
      'recurring_maintenance_horizon_invalid',
      `Recurring maintenance horizon must be between 1 and ${maximumHorizonDays} days`
    );
  }
  if (
    !Number.isInteger(occurrenceLimit) ||
    occurrenceLimit < 1 ||
    occurrenceLimit > maximumOccurrenceLimit
  ) {
    throw eventError(
      'recurring_maintenance_limit_invalid',
      `Recurring maintenance occurrence limit must be between 1 and ${maximumOccurrenceLimit}`
    );
  }

  return database.transaction(() => {
    const plan = getRecurringMaintenancePlan(database, planId);
    if (!plan) {
      throw eventError(
        'recurring_maintenance_not_found',
        'Recurring maintenance plan does not exist'
      );
    }
    if (options.expectedVersion !== undefined && plan.version !== options.expectedVersion) {
      throw eventError(
        'recurring_maintenance_version_conflict',
        `Expected version ${options.expectedVersion}, active version is ${plan.version}`
      );
    }
    const evaluatedAt = validateClock(
      options.now?.() ?? new Date(),
      'recurring_maintenance_clock_invalid',
      'Recurring maintenance clock is invalid'
    );
    const horizonAt = new Date(evaluatedAt.valueOf() + horizonDays * millisecondsPerDay);
    if (plan.state !== 'active' || plan.nextOccurrenceAt === null) {
      return {
        planId,
        planVersion: plan.version,
        evaluatedAt: evaluatedAt.toISOString(),
        horizonAt: horizonAt.toISOString(),
        materializedOccurrences: 0,
        existingOccurrences: 0,
        nextOccurrenceAt: plan.nextOccurrenceAt,
        hasMore: false,
      };
    }

    const schedule = plan.schedule;
    const storedCursor = Date.parse(plan.nextOccurrenceAt);
    let candidate = nextRecurringOccurrenceAt(
      schedule,
      new Date(Math.max(storedCursor, evaluatedAt.valueOf()))
    );
    let materializedOccurrences = 0;
    let existingOccurrences = 0;
    let evaluatedCandidates = 0;
    const maximumCandidates = maximumOccurrenceLimit;

    while (
      candidate &&
      Date.parse(candidate) <= horizonAt.valueOf() &&
      materializedOccurrences < occurrenceLimit &&
      evaluatedCandidates < maximumCandidates
    ) {
      evaluatedCandidates += 1;
      const existing = database
        .prepare(
          `SELECT id FROM recurring_maintenance_occurrences
           WHERE plan_id = ? AND scheduled_start_at = ?`
        )
        .get(plan.id, candidate) as { id: string } | undefined;
      if (existing) {
        existingOccurrences += 1;
      } else {
        const scheduledEndAt = new Date(
          Date.parse(candidate) + schedule.durationMinutes * millisecondsPerMinute
        ).toISOString();
        const requestId = `recurring-maintenance:${plan.id}:${candidate}`;
        const maintenance = createMaintenance(
          database,
          {
            pageId: plan.pageId,
            title: plan.title,
            body: plan.body,
            state: 'draft',
            affectedComponentIds: plan.affectedComponentIds,
            occurredAt: candidate,
            scheduledStartAt: candidate,
            scheduledEndAt,
          },
          requestId,
          { actorId: systemActor, requestId }
        );
        database
          .prepare(
            `INSERT INTO recurring_maintenance_occurrences
              (id, plan_id, plan_version, event_id, scheduled_start_at,
               scheduled_end_at, materialized_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            randomUUID(),
            plan.id,
            plan.version,
            maintenance.id,
            candidate,
            scheduledEndAt,
            evaluatedAt.toISOString()
          );
        materializedOccurrences += 1;
      }
      candidate = nextRecurringOccurrenceAt(schedule, new Date(Date.parse(candidate) + 1));
    }

    const hasMore = Boolean(candidate && Date.parse(candidate) <= horizonAt.valueOf());
    database
      .prepare(
        `UPDATE recurring_maintenance_plans
         SET next_occurrence_at = ?, updated_at = ?
         WHERE id = ? AND version = ?`
      )
      .run(candidate, evaluatedAt.toISOString(), plan.id, plan.version);
    const updated = getRecurringMaintenancePlan(
      database,
      plan.id
    ) as RecurringMaintenancePlanRecord;
    if (
      materializedOccurrences > 0 ||
      existingOccurrences > 0 ||
      updated.nextOccurrenceAt !== plan.nextOccurrenceAt
    ) {
      writePlanAudit(
        database,
        { actorId: systemActor, requestId: `recurring-maintenance:${plan.id}:${plan.version}` },
        'recurring_maintenance.materialize',
        updated,
        { materializedOccurrences, existingOccurrences, horizonAt: horizonAt.toISOString() }
      );
    }
    return {
      planId: plan.id,
      planVersion: plan.version,
      evaluatedAt: evaluatedAt.toISOString(),
      horizonAt: horizonAt.toISOString(),
      materializedOccurrences,
      existingOccurrences,
      nextOccurrenceAt: candidate,
      hasMore,
    };
  })();
};

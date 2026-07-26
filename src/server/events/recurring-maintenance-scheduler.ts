import type Database from 'better-sqlite3';
import {
  materializeRecurringMaintenancePlan,
  type RecurringMaintenanceMaterialization,
} from './recurring-maintenance-repository.js';

const millisecondsPerDay = 24 * 60 * 60_000;
const defaultHorizonDays = 35;
const defaultBatchSize = 25;
const defaultIntervalMilliseconds = 60 * 60_000;

export interface RecurringMaintenanceFailure {
  planId: string;
  code: string;
}

export interface RecurringMaintenanceRun {
  evaluatedAt: string;
  horizonAt: string;
  duePlans: number;
  materializedPlans: number;
  materializedOccurrences: number;
  hasMore: boolean;
  failures: RecurringMaintenanceFailure[];
}

export interface RecurringMaintenanceService {
  run(): RecurringMaintenanceRun;
}

export const recurringMaintenanceErrorCode = (error: unknown) =>
  typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'recurring_maintenance_failed';

const schedulerError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

export const createRecurringMaintenanceService = ({
  database,
  now = () => new Date(),
  horizonDays = defaultHorizonDays,
  batchSize = defaultBatchSize,
}: {
  database: Database.Database;
  now?: () => Date;
  horizonDays?: number;
  batchSize?: number;
}): RecurringMaintenanceService => {
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 90) {
    throw schedulerError(
      'recurring_maintenance_horizon_invalid',
      'Recurring maintenance horizon must be between 1 and 90 days'
    );
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw schedulerError(
      'recurring_maintenance_batch_invalid',
      'Recurring maintenance batch size must be between 1 and 100'
    );
  }

  const run = (): RecurringMaintenanceRun => {
    const evaluatedAt = now();
    if (Number.isNaN(evaluatedAt.valueOf())) {
      throw schedulerError(
        'recurring_maintenance_clock_invalid',
        'Recurring maintenance clock is invalid'
      );
    }
    const horizonAt = new Date(evaluatedAt.valueOf() + horizonDays * millisecondsPerDay);
    const rows = database
      .prepare(
        `SELECT id
         FROM recurring_maintenance_plans
         WHERE state = 'active'
           AND next_occurrence_at IS NOT NULL
           AND next_occurrence_at <= ?
         ORDER BY next_occurrence_at ASC, id ASC
         LIMIT ?`
      )
      .all(horizonAt.toISOString(), batchSize) as Array<{ id: string }>;

    const materializations: RecurringMaintenanceMaterialization[] = [];
    const failures: RecurringMaintenanceFailure[] = [];
    for (const row of rows) {
      try {
        materializations.push(
          materializeRecurringMaintenancePlan(database, row.id, {
            now: () => evaluatedAt,
            horizonDays,
          })
        );
      } catch (error) {
        failures.push({ planId: row.id, code: recurringMaintenanceErrorCode(error) });
      }
    }

    return {
      evaluatedAt: evaluatedAt.toISOString(),
      horizonAt: horizonAt.toISOString(),
      duePlans: rows.length,
      materializedPlans: materializations.filter(item => item.materializedOccurrences > 0).length,
      materializedOccurrences: materializations.reduce(
        (total, item) => total + item.materializedOccurrences,
        0
      ),
      hasMore: rows.length === batchSize || materializations.some(item => item.hasMore),
      failures,
    };
  };
  return { run };
};

export const startRecurringMaintenanceScheduler = ({
  service,
  intervalMilliseconds = defaultIntervalMilliseconds,
  onRun,
  onError = error =>
    console.error('Recurring maintenance materialization failed', {
      code: recurringMaintenanceErrorCode(error),
    }),
}: {
  service: RecurringMaintenanceService;
  intervalMilliseconds?: number;
  onRun?: (result: RecurringMaintenanceRun) => void;
  onError?: (error: unknown) => void;
}) => {
  if (
    !Number.isInteger(intervalMilliseconds) ||
    intervalMilliseconds < 60_000 ||
    intervalMilliseconds > 24 * 60 * 60_000
  ) {
    throw schedulerError(
      'recurring_maintenance_interval_invalid',
      'Recurring maintenance interval must be between 1 minute and 24 hours'
    );
  }
  const execute = () => {
    try {
      const result = service.run();
      onRun?.(result);
      if (result.failures.length > 0) {
        onError(
          schedulerError(
            'recurring_maintenance_partial',
            `${result.failures.length} recurring maintenance plans failed`
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

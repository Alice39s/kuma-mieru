import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import {
  appendRecurringMaintenancePlanUpdate,
  createRecurringMaintenancePlan,
  getRecurringMaintenancePlan,
  listRecurringMaintenanceOccurrences,
  materializeRecurringMaintenancePlan,
  nextRecurringOccurrenceAt,
  type RecurringMaintenanceSchedule,
} from './recurring-maintenance-repository.js';
import { createRecurringMaintenanceService } from './recurring-maintenance-scheduler.js';

const audit = { actorId: 'owner-1', requestId: 'recurring-maintenance-request-1' };
const july27 = () => new Date('2026-07-27T00:00:00.000Z');

const dailyPlanContent = {
  name: 'Daily database window',
  title: 'Database maintenance',
  body: 'We will apply routine database updates.',
  affectedComponentIds: ['database'],
  timeBasis: 'utc' as const,
  frequency: 'daily' as const,
  interval: 1,
  weekdays: [],
  anchorStartAt: '2026-07-28T01:00:00.000Z',
  durationMinutes: 60,
  endsAt: '2026-08-02T01:00:00.000Z',
};
const dailyInput = { pageId: 'public', state: 'active' as const, ...dailyPlanContent };

test('calculates bounded UTC daily and weekly recurrence without state rollback', () => {
  const daily: RecurringMaintenanceSchedule = {
    timeBasis: 'utc',
    frequency: 'daily',
    interval: 2,
    weekdays: [],
    anchorStartAt: '2026-07-27T01:00:00.000Z',
    durationMinutes: 60,
    endsAt: '2026-07-31T01:00:00.000Z',
  };
  assert.equal(
    nextRecurringOccurrenceAt(daily, new Date('2026-07-27T01:00:00.000Z')),
    '2026-07-27T01:00:00.000Z'
  );
  assert.equal(
    nextRecurringOccurrenceAt(daily, new Date('2026-07-27T01:00:00.001Z')),
    '2026-07-29T01:00:00.000Z'
  );
  assert.equal(nextRecurringOccurrenceAt(daily, new Date('2026-07-31T01:00:00.001Z')), null);

  const weekly: RecurringMaintenanceSchedule = {
    timeBasis: 'utc',
    frequency: 'weekly',
    interval: 2,
    weekdays: [2, 4],
    anchorStartAt: '2026-07-27T02:00:00.000Z',
    durationMinutes: 90,
    endsAt: null,
  };
  assert.equal(
    nextRecurringOccurrenceAt(weekly, new Date('2026-07-27T00:00:00.000Z')),
    '2026-07-28T02:00:00.000Z'
  );
  assert.equal(
    nextRecurringOccurrenceAt(weekly, new Date('2026-07-28T02:00:00.001Z')),
    '2026-07-30T02:00:00.000Z'
  );
  assert.equal(
    nextRecurringOccurrenceAt(weekly, new Date('2026-07-30T02:00:00.001Z')),
    '2026-08-11T02:00:00.000Z'
  );
});

test('materializes independent private drafts idempotently and versions future occurrences', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-recurring-maintenance-'));
  const databasePath = resolve(directory, 'recurring-maintenance.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const created = createRecurringMaintenancePlan(
      database,
      dailyInput,
      'recurring-maintenance-create-0001',
      audit,
      july27
    );
    assert.equal(created.state, 'active');
    assert.equal(created.version, 1);
    assert.equal(created.nextOccurrenceAt, '2026-07-28T01:00:00.000Z');

    const materialized = materializeRecurringMaintenancePlan(database, created.id, {
      expectedVersion: 1,
      now: july27,
      horizonDays: 4,
    });
    assert.equal(materialized.materializedOccurrences, 3);
    assert.equal(materialized.existingOccurrences, 0);
    assert.equal(materialized.nextOccurrenceAt, '2026-07-31T01:00:00.000Z');
    assert.equal(materialized.hasMore, false);

    const occurrences = listRecurringMaintenanceOccurrences(database, created.id);
    assert.equal(occurrences.length, 3);
    assert.deepEqual(
      occurrences.map(occurrence => occurrence.planVersion),
      [1, 1, 1]
    );
    assert.equal(
      occurrences.every(occurrence => occurrence.maintenance.state === 'draft'),
      true
    );
    assert.equal(
      occurrences.every(
        occurrence =>
          occurrence.maintenance.latestEntry.body === 'We will apply routine database updates.'
      ),
      true
    );
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM event_publications').get() as {
          count: number;
        }
      ).count,
      0
    );
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get() as {
          count: number;
        }
      ).count,
      0
    );

    const repeated = materializeRecurringMaintenancePlan(database, created.id, {
      expectedVersion: 1,
      now: july27,
      horizonDays: 4,
    });
    assert.equal(repeated.materializedOccurrences, 0);
    assert.equal(listRecurringMaintenanceOccurrences(database, created.id).length, 3);

    const paused = appendRecurringMaintenancePlanUpdate(
      database,
      created.id,
      {
        expectedVersion: 1,
        state: 'paused',
        ...dailyPlanContent,
        name: 'Daily database window',
      },
      audit,
      july27
    );
    assert.equal(paused.nextOccurrenceAt, null);
    const pausedRun = materializeRecurringMaintenancePlan(database, created.id, {
      expectedVersion: 2,
      now: july27,
      horizonDays: 5,
    });
    assert.equal(pausedRun.materializedOccurrences, 0);

    const reactivated = appendRecurringMaintenancePlanUpdate(
      database,
      created.id,
      {
        expectedVersion: 2,
        state: 'active',
        ...dailyPlanContent,
        title: 'Database maintenance v2',
      },
      audit,
      july27
    );
    assert.equal(reactivated.version, 3);
    const versionThreeRun = materializeRecurringMaintenancePlan(database, created.id, {
      expectedVersion: 3,
      now: july27,
      horizonDays: 5,
    });
    assert.equal(versionThreeRun.existingOccurrences, 3);
    assert.equal(versionThreeRun.materializedOccurrences, 1);

    const versionedOccurrences = listRecurringMaintenanceOccurrences(database, created.id);
    assert.deepEqual(
      versionedOccurrences.map(occurrence => occurrence.planVersion),
      [3, 1, 1, 1]
    );
    assert.equal(versionedOccurrences[0]?.maintenance.title, 'Database maintenance v2');
    assert.equal(versionedOccurrences[1]?.maintenance.title, 'Database maintenance');

    const archived = appendRecurringMaintenancePlanUpdate(
      database,
      created.id,
      {
        expectedVersion: 3,
        state: 'archived',
        ...dailyPlanContent,
        title: 'Database maintenance v2',
      },
      audit,
      july27
    );
    assert.equal(archived.state, 'archived');
    assert.throws(
      () =>
        appendRecurringMaintenancePlanUpdate(
          database,
          created.id,
          {
            expectedVersion: 4,
            state: 'active',
            ...dailyPlanContent,
          },
          audit,
          july27
        ),
      error => {
        assert.equal((error as { code: string }).code, 'invalid_recurring_maintenance_transition');
        return true;
      }
    );
    assert.equal(getRecurringMaintenancePlan(database, created.id)?.version, 4);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('scheduler catches up active plans and reports invalid boundaries per plan', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-recurring-scheduler-'));
  const databasePath = resolve(directory, 'recurring-scheduler.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const plan = createRecurringMaintenancePlan(
      database,
      dailyInput,
      'recurring-maintenance-scheduler-0001',
      audit,
      july27
    );
    const service = createRecurringMaintenanceService({
      database,
      now: july27,
      horizonDays: 4,
    });
    const run = service.run();
    assert.equal(run.duePlans, 1);
    assert.equal(run.materializedPlans, 1);
    assert.equal(run.materializedOccurrences, 3);
    assert.deepEqual(run.failures, []);

    database
      .prepare(
        `UPDATE recurring_maintenance_plan_entries
         SET weekdays_json = 'not-json'
         WHERE plan_id = ? AND sequence = 1`
      )
      .run(plan.id);
    database
      .prepare(
        `UPDATE recurring_maintenance_plans
         SET next_occurrence_at = '2026-07-28T01:00:00.000Z'
         WHERE id = ?`
      )
      .run(plan.id);
    const failed = service.run();
    assert.equal(failed.duePlans, 1);
    assert.deepEqual(failed.failures, [{ planId: plan.id, code: 'recurring_maintenance_failed' }]);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

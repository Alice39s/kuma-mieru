import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import type Database from 'better-sqlite3';
import { canonicalConfigSchema } from '../config/schema.js';
import type { AuditContext } from '../config/managed-config.js';
import type { NormalizedSnapshot } from '../adapters/types.js';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import {
  acceptAutomationSuggestion,
  ignoreAutomationSuggestion,
  listAutomationSuggestions,
  reconcileSignalAutomation,
} from './automation-repository.js';

const config = canonicalConfigSchema.parse({
  schemaVersion: 1,
  sources: [
    {
      id: 'primary',
      kind: 'uptime-kuma',
      baseUrl: 'https://status.example.com',
      pageIds: ['main'],
    },
  ],
  pages: [
    {
      id: 'public',
      slug: 'main',
      title: 'Status',
      sourceRefs: ['primary'],
    },
  ],
  events: {
    automation: {
      defaultAction: 'suggest-draft',
      degradedConsecutive: 3,
      recoveryConsecutive: 2,
      cooldownMs: 15 * 60_000,
    },
  },
});

const snapshot = (
  fetchedAt: string,
  status: NormalizedSnapshot['services'][number]['status']
): NormalizedSnapshot => ({
  sourceId: 'primary',
  pageId: 'main',
  title: 'Provider Status',
  description: '',
  status,
  fetchedAt,
  sourceUpdatedAt: fetchedAt,
  extensions: {},
  capabilities: {
    currentStatus: true,
    heartbeatSeries: true,
    latencySeries: true,
    uptimeWindows: ['24h'],
    incidents: 'current',
    maintenance: true,
    groups: true,
    tags: true,
    nativeMetrics: false,
    historicalDays: 1,
  },
  groups: [{ id: 'api', name: 'API', position: 0, serviceIds: ['api'] }],
  services: [
    {
      id: 'api',
      sourceId: 'primary',
      upstreamId: '42',
      name: 'Inference API',
      groupId: 'api',
      tags: [],
      status,
      rawStatus: status,
      latencyMs: 120,
      observedAt: fetchedAt,
      uptime24h: 0.99,
    },
  ],
  incidents: [],
});

const audit: AuditContext = {
  actorId: 'operator',
  requestId: 'automation-test',
  ipAddress: '127.0.0.1',
  userAgent: 'node-test',
};

const tableCount = (database: Database.Database, table: string) =>
  (
    database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;

test('debounces source signals and requires human acceptance for degradation and recovery', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-signal-automation-'));
  const databasePath = resolve(directory, 'automation.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const reconcile = (at: string, status: NormalizedSnapshot['services'][number]['status']) =>
      reconcileSignalAutomation(database, config, snapshot(at, status), {
        now: () => new Date(at),
      });

    assert.deepEqual(reconcile('2026-07-25T10:00:00.000Z', 'major_outage'), {
      debouncing_degradation: 1,
    });
    assert.deepEqual(reconcile('2026-07-25T10:00:00.000Z', 'major_outage'), { stale: 1 });
    assert.deepEqual(reconcile('2026-07-25T10:01:00.000Z', 'major_outage'), {
      debouncing_degradation: 1,
    });
    assert.deepEqual(reconcile('2026-07-25T10:02:00.000Z', 'major_outage'), {
      degradation_created: 1,
    });

    const degradation = listAutomationSuggestions(database, 'pending')[0];
    assert.equal(degradation?.kind, 'degradation');
    assert.equal(degradation?.notificationEligible, false);
    assert.equal(degradation?.evidence.consecutiveCount, 3);
    assert.equal(tableCount(database, 'native_events'), 0);
    assert.equal(tableCount(database, 'event_publications'), 0);
    assert.equal(tableCount(database, 'notification_outbox'), 0);

    const acceptedDegradation = acceptAutomationSuggestion(
      database,
      {
        suggestionId: degradation!.id,
        expectedVersion: degradation!.version,
        idempotencyKey: 'accept-degradation',
      },
      audit
    );
    assert.equal(acceptedDegradation.suggestion.state, 'accepted');
    assert.equal(acceptedDegradation.incident.state, 'investigating');
    assert.equal(acceptedDegradation.incident.createdBy, 'operator');
    assert.deepEqual(acceptedDegradation.incident.latestEntry.affectedComponentIds, ['api']);
    assert.equal(tableCount(database, 'event_publications'), 0);
    assert.equal(tableCount(database, 'notification_outbox'), 0);

    assert.deepEqual(reconcile('2026-07-25T10:03:00.000Z', 'major_outage'), {
      active_incident: 1,
    });
    assert.deepEqual(reconcile('2026-07-25T10:04:00.000Z', 'operational'), {
      debouncing_recovery: 1,
    });
    assert.deepEqual(reconcile('2026-07-25T10:05:00.000Z', 'operational'), {
      recovery_created: 1,
    });
    const recovery = listAutomationSuggestions(database, 'pending')[0];
    assert.equal(recovery?.kind, 'recovery');
    assert.equal(recovery?.nativeEventId, acceptedDegradation.incident.id);
    assert.equal(recovery?.nativeEventVersion, 1);

    assert.throws(
      () =>
        acceptAutomationSuggestion(
          database,
          {
            suggestionId: recovery!.id,
            expectedVersion: recovery!.version,
            idempotencyKey: 'accept-recovery',
          },
          audit
        ),
      /target version must be reviewed explicitly/u
    );
    const acceptedRecovery = acceptAutomationSuggestion(
      database,
      {
        suggestionId: recovery!.id,
        expectedVersion: recovery!.version,
        expectedNativeEventVersion: recovery!.nativeEventVersion!,
        idempotencyKey: 'accept-recovery',
      },
      audit
    );
    assert.equal(acceptedRecovery.incident.state, 'resolved');
    assert.equal(acceptedRecovery.incident.version, 2);
    assert.equal(acceptedRecovery.suggestion.state, 'accepted');
    assert.equal(tableCount(database, 'native_events'), 1);
    assert.equal(tableCount(database, 'event_publications'), 0);
    assert.equal(tableCount(database, 'notification_outbox'), 0);
    assert.equal(tableCount(database, 'signal_observations'), 6);
    assert.equal(tableCount(database, 'automation_decisions'), 6);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('suppresses maintenance and honors ignore cooldown without publishing', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-signal-cooldown-'));
  const databasePath = resolve(directory, 'automation.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const reconcile = (
      observedAt: string,
      recordedAt: string,
      status: NormalizedSnapshot['services'][number]['status']
    ) =>
      reconcileSignalAutomation(database, config, snapshot(observedAt, status), {
        now: () => new Date(recordedAt),
      });

    assert.deepEqual(
      reconcile('2026-07-25T11:00:00.000Z', '2026-07-25T11:00:00.000Z', 'maintenance'),
      { maintenance_suppressed: 1 }
    );
    assert.equal(listAutomationSuggestions(database).length, 0);

    for (const minute of [1, 2, 3]) {
      reconcile(`2026-07-25T11:0${minute}:00.000Z`, `2026-07-25T11:0${minute}:00.000Z`, 'degraded');
    }
    const suggestion = listAutomationSuggestions(database, 'pending')[0]!;
    const ignored = ignoreAutomationSuggestion(
      database,
      {
        suggestionId: suggestion.id,
        expectedVersion: suggestion.version,
        cooldownMs: config.events!.automation!.cooldownMs,
        now: () => new Date('2026-07-25T11:03:00.000Z'),
      },
      audit
    );
    assert.equal(ignored.state, 'ignored');
    assert.deepEqual(
      reconcile('2026-07-25T11:04:00.000Z', '2026-07-25T11:04:00.000Z', 'major_outage'),
      { cooldown: 1 }
    );
    assert.equal(listAutomationSuggestions(database, 'pending').length, 0);
    assert.deepEqual(
      reconcile('2026-07-25T11:20:00.000Z', '2026-07-25T11:20:00.000Z', 'major_outage'),
      { degradation_created: 1 }
    );
    assert.equal(listAutomationSuggestions(database, 'pending').length, 1);
    assert.equal(tableCount(database, 'native_events'), 0);
    assert.equal(tableCount(database, 'event_publications'), 0);
    assert.equal(tableCount(database, 'notification_outbox'), 0);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

import { cpus, totalmem, tmpdir } from 'node:os';
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { migrateDatabase } from '../src/server/db/migrator.ts';
import { openDatabase } from '../src/server/db/database.ts';

const mebibyte = 1024 * 1024;
const releaseMinimumRuns = 20;
const releaseMinimumFixtureBytes = 128 * mebibyte;

const positiveInteger = z.coerce.number().int().positive();
const nonnegativeNumber = z.coerce.number().nonnegative();
const optionsSchema = z.object({
  profile: z.enum(['release', 'smoke']),
  targetVersion: positiveInteger.min(2).optional(),
  runs: positiveInteger,
  auditRows: nonnegativeNumber.int(),
  signalRows: nonnegativeNumber.int(),
  mirroredRows: nonnegativeNumber.int(),
  nativeEventRows: nonnegativeNumber.int(),
  payloadBytes: positiveInteger.min(128).max(16 * 1024),
  maxP95Milliseconds: positiveInteger,
  maxWriteLockMilliseconds: nonnegativeNumber,
  maxTemporarySpaceRatio: z.coerce.number().positive(),
  output: z.string().min(1).optional(),
});

const { values } = parseArgs({
  options: {
    profile: { type: 'string', default: 'release' },
    'target-version': { type: 'string' },
    runs: { type: 'string', default: '20' },
    'audit-rows': { type: 'string', default: '50000' },
    'signal-rows': { type: 'string', default: '100000' },
    'mirrored-rows': { type: 'string', default: '25000' },
    'native-event-rows': { type: 'string', default: '0' },
    'payload-bytes': { type: 'string', default: '512' },
    'max-p95-ms': { type: 'string', default: '30000' },
    'max-write-lock-ms': { type: 'string', default: '250' },
    'max-temp-ratio': { type: 'string', default: '1.25' },
    output: { type: 'string' },
  },
  strict: true,
});

const options = optionsSchema.parse({
  profile: values.profile,
  targetVersion: values['target-version'],
  runs: values.runs,
  auditRows: values['audit-rows'],
  signalRows: values['signal-rows'],
  mirroredRows: values['mirrored-rows'],
  nativeEventRows: values['native-event-rows'],
  payloadBytes: values['payload-bytes'],
  maxP95Milliseconds: values['max-p95-ms'],
  maxWriteLockMilliseconds: values['max-write-lock-ms'],
  maxTemporarySpaceRatio: values['max-temp-ratio'],
  output: values.output,
});

const round = (value: number) => Math.round(value * 1000) / 1000;

const percentile = (values_: number[], percentile_: number) => {
  const sorted = [...values_].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile_ * sorted.length) - 1);
  return sorted[index] ?? 0;
};

const pathSize = async (path: string): Promise<number> => {
  const metadata = await stat(path).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (!metadata) return 0;
  if (!metadata.isDirectory()) return metadata.size;
  const entries = await readdir(path).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  const sizes = await Promise.all(entries.map(entry => pathSize(resolve(path, entry))));
  return sizes.reduce((total, size) => total + size, 0);
};

const writeReport = async (path: string, report: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  const partialPath = `${path}.partial-${process.pid}`;
  await writeFile(partialPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(partialPath, path);
};

const seedFixture = (database: ReturnType<typeof openDatabase>['database'], payload: string) => {
  const occurredAt = '2026-07-25T00:00:00.000Z';
  const insertAudit = database.prepare(
    `INSERT INTO admin_audit
      (id, occurred_at, actor_id, action, target_type, target_id, request_id, result,
       before_json, after_json)
     VALUES (?, ?, 'benchmark-owner', 'benchmark.write', 'fixture', ?, ?, 'success', ?, ?)`
  );
  database.transaction(() => {
    for (let index = 0; index < options.auditRows; index += 1) {
      const id = `audit_${String(index).padStart(12, '0')}`;
      insertAudit.run(id, occurredAt, id, `request_${id}`, payload, payload);
    }
  })();

  const insertSignal = database.prepare(
    `INSERT INTO signal_observations
      (id, page_id, source_id, source_page_id, service_id, service_name, normalized_status,
       raw_status_json, latency_ms, observed_at, recorded_at)
     VALUES (?, 'benchmark-page', 'benchmark-source', 'benchmark-source-page', ?, ?,
             'operational', ?, 10, ?, ?)`
  );
  database.transaction(() => {
    for (let index = 0; index < options.signalRows; index += 1) {
      const id = `signal_${String(index).padStart(12, '0')}`;
      const observedAt = `2026-07-${String((index % 25) + 1).padStart(2, '0')}T${String(
        index % 24
      ).padStart(2, '0')}:00:${String(index % 60).padStart(2, '0')}.000Z`;
      insertSignal.run(id, id, `Benchmark service ${index}`, payload, observedAt, observedAt);
    }
  })();

  const insertMirroredEvent = database.prepare(
    `INSERT INTO mirrored_events
      (id, source_id, source_page_id, upstream_event_id, type, source_url, presence, version,
       latest_content_hash, latest_snapshot_json, first_seen_at, last_seen_at, updated_at)
     VALUES (?, 'benchmark-source', 'benchmark-source-page', ?, 'incident',
             'https://status.example.test', 'present', 1, ?, ?, ?, ?, ?)`
  );
  const insertMirroredEntry = database.prepare(
    `INSERT INTO mirrored_event_entries
      (id, mirrored_event_id, sequence, observation_kind, snapshot_json, content_hash,
       observed_at, recorded_at)
     VALUES (?, ?, 1, 'initial', ?, ?, ?, ?)`
  );
  database.transaction(() => {
    for (let index = 0; index < options.mirroredRows; index += 1) {
      const id = `mirrored_${String(index).padStart(12, '0')}`;
      const hash = String(index).padStart(64, '0').slice(-64);
      insertMirroredEvent.run(id, id, hash, payload, occurredAt, occurredAt, occurredAt);
      insertMirroredEntry.run(`${id}_entry`, id, payload, hash, occurredAt, occurredAt);
    }
  })();

  if (options.nativeEventRows > 0) {
    const nativeEventColumns = database.prepare('PRAGMA table_info(native_events)').all() as Array<{
      name: string;
    }>;
    if (!nativeEventColumns.some(column => column.name === 'details_json')) {
      throw new Error(
        'Native-event fixture rows require a source schema with native_events.details_json'
      );
    }
    const insertNativeEvent = database.prepare(
      `INSERT INTO native_events
        (id, type, page_id, title, state, version, created_by, idempotency_key, request_hash,
         created_at, updated_at, details_json)
       VALUES (?, ?, 'benchmark-page', ?, ?, 1, 'benchmark-owner', ?, ?, ?, ?, ?)`
    );
    const variants = [
      {
        type: 'maintenance',
        state: 'scheduled',
        details: {
          scheduledStartAt: '2026-07-25T01:00:00.000Z',
          scheduledEndAt: '2026-07-25T02:00:00.000Z',
        },
      },
      {
        type: 'maintenance',
        state: 'in_progress',
        details: {
          scheduledStartAt: '2026-07-25T01:00:00.000Z',
          scheduledEndAt: '2026-07-25T02:00:00.000Z',
        },
      },
      {
        type: 'notice',
        state: 'published',
        details: { endsAt: '2026-07-25T03:00:00.000Z' },
      },
      {
        type: 'incident',
        state: 'investigating',
        details: {},
      },
    ] as const;
    database.transaction(() => {
      for (let index = 0; index < options.nativeEventRows; index += 1) {
        const id = `native_${String(index).padStart(12, '0')}`;
        const variant = variants[index % variants.length] as (typeof variants)[number];
        insertNativeEvent.run(
          id,
          variant.type,
          `Benchmark native event ${index}`,
          variant.state,
          id,
          id,
          occurredAt,
          occurredAt,
          JSON.stringify({ ...variant.details, fixture: payload })
        );
      }
    })();
  }
};

const run = async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-migration-benchmark-'));
  try {
    const migrationDirectory = resolve(process.cwd(), 'migrations');
    const availableMigrationNames = (await readdir(migrationDirectory))
      .filter(name => name.endsWith('.up.sql'))
      .sort();
    const targetVersion = options.targetVersion ?? availableMigrationNames.length;
    if (targetVersion > availableMigrationNames.length) {
      throw new Error(
        `Target migration ${targetVersion} exceeds latest migration ${availableMigrationNames.length}`
      );
    }
    const migrationNames = availableMigrationNames.slice(0, targetVersion);
    if (migrationNames.length < 2) throw new Error('At least two migrations are required');
    const targetMigrationDirectory = resolve(root, 'target-migrations');
    const previousMigrationDirectory = resolve(root, 'previous-migrations');
    await mkdir(targetMigrationDirectory, { recursive: true });
    await mkdir(previousMigrationDirectory, { recursive: true });
    for (const name of migrationNames) {
      await copyFile(resolve(migrationDirectory, name), resolve(targetMigrationDirectory, name));
    }
    for (const name of migrationNames.slice(0, -1)) {
      await copyFile(resolve(migrationDirectory, name), resolve(previousMigrationDirectory, name));
    }
    const fromVersion = migrationNames.length - 1;
    const toVersion = migrationNames.length;
    const expectedLifecycleDueEvents =
      toVersion === 17 && options.nativeEventRows > 0
        ? Math.floor(options.nativeEventRows / 4) * 3 + Math.min(options.nativeEventRows % 4, 3)
        : null;
    const baseDatabasePath = resolve(root, `schema-${fromVersion}-fixture.sqlite3`);
    const base = openDatabase(baseDatabasePath);
    await migrateDatabase(base.database, {
      directory: previousMigrationDirectory,
      appBuild: 'migration-benchmark-fixture',
    });
    const payload = JSON.stringify({
      fixture: 'kuma-mieru-real-scale-migration',
      value: 'x'.repeat(options.payloadBytes),
    });
    seedFixture(base.database, payload);
    base.database.pragma('wal_checkpoint(TRUNCATE)');
    base.database.close();
    const baseDatabaseBytes = (await stat(baseDatabasePath)).size;

    const trials = [];
    for (let trial = 1; trial <= options.runs; trial += 1) {
      const trialDirectory = resolve(root, `trial-${String(trial).padStart(3, '0')}`);
      const databasePath = resolve(trialDirectory, 'kuma-mieru.sqlite3');
      await mkdir(trialDirectory, { recursive: true });
      await copyFile(baseDatabasePath, databasePath);
      const baselineDirectoryBytes = await pathSize(trialDirectory);
      let peakDirectoryBytes = baselineDirectoryBytes;
      let sampling = true;
      let samplingError: unknown;
      const sampler = (async () => {
        while (sampling) {
          try {
            peakDirectoryBytes = Math.max(peakDirectoryBytes, await pathSize(trialDirectory));
          } catch (error) {
            samplingError = error;
            return;
          }
          await delay(2);
        }
      })();
      const database = openDatabase(databasePath);
      const writeLocks: Array<{ version: number; name: string; milliseconds: number }> = [];
      const startedAt = performance.now();
      let result;
      try {
        result = await migrateDatabase(database.database, {
          directory: targetMigrationDirectory,
          databasePath,
          appBuild: 'migration-benchmark',
          onMigrationApplied: measurement =>
            writeLocks.push({
              version: measurement.version,
              name: measurement.name,
              milliseconds: measurement.writeLockMilliseconds,
            }),
        });
      } finally {
        database.database.close();
        sampling = false;
        await sampler;
      }
      if (samplingError) throw samplingError;
      peakDirectoryBytes = Math.max(peakDirectoryBytes, await pathSize(trialDirectory));
      const totalMilliseconds = performance.now() - startedAt;
      const latestWriteLock = writeLocks.find(measurement => measurement.version === toVersion);
      if (!latestWriteLock) throw new Error(`Migration ${toVersion} did not report its write lock`);
      const migrated = openDatabase(databasePath);
      const ledger = migrated.database
        .prepare('SELECT execution_ms FROM schema_migrations WHERE version = ?')
        .get(toVersion) as { execution_ms: number } | undefined;
      const lifecycleDueEvents =
        expectedLifecycleDueEvents === null
          ? null
          : (
              migrated.database
                .prepare(
                  `SELECT COUNT(*) AS count
                   FROM native_events
                   WHERE lifecycle_due_at IS NOT NULL`
                )
                .get() as { count: number }
            ).count;
      migrated.database.close();
      if (!ledger || result.currentVersion !== toVersion || result.applied.at(-1) !== toVersion) {
        throw new Error(`Migration ${fromVersion} -> ${toVersion} did not complete`);
      }
      if (
        expectedLifecycleDueEvents !== null &&
        lifecycleDueEvents !== expectedLifecycleDueEvents
      ) {
        throw new Error(
          `Migration 17 backfilled ${lifecycleDueEvents} lifecycle rows; expected ${expectedLifecycleDueEvents}`
        );
      }
      const peakExtraBytes = Math.max(0, peakDirectoryBytes - baselineDirectoryBytes);
      const trialResult = {
        trial,
        totalMilliseconds: round(totalMilliseconds),
        writeLockMilliseconds: round(latestWriteLock.milliseconds),
        ledgerExecutionMilliseconds: ledger.execution_ms,
        baselineDirectoryBytes,
        peakDirectoryBytes,
        peakExtraBytes,
        temporarySpaceRatio: round(peakExtraBytes / baseDatabaseBytes),
      };
      trials.push(trialResult);
      process.stderr.write(
        `migration benchmark ${trial}/${options.runs}: ${JSON.stringify(trialResult)}\n`
      );
      await rm(trialDirectory, { recursive: true, force: true });
    }

    const totalMilliseconds = trials.map(trial => trial.totalMilliseconds);
    const writeLockMilliseconds = trials.map(trial => trial.writeLockMilliseconds);
    const temporarySpaceRatio = trials.map(trial => trial.temporarySpaceRatio);
    const peakExtraBytes = trials.map(trial => trial.peakExtraBytes);
    const summary = {
      totalMilliseconds: {
        p50: round(percentile(totalMilliseconds, 0.5)),
        p95: round(percentile(totalMilliseconds, 0.95)),
        max: round(Math.max(...totalMilliseconds)),
      },
      writeLockMilliseconds: {
        p50: round(percentile(writeLockMilliseconds, 0.5)),
        p95: round(percentile(writeLockMilliseconds, 0.95)),
        max: round(Math.max(...writeLockMilliseconds)),
      },
      temporarySpace: {
        p95ExtraBytes: percentile(peakExtraBytes, 0.95),
        maxExtraBytes: Math.max(...peakExtraBytes),
        p95Ratio: round(percentile(temporarySpaceRatio, 0.95)),
        maxRatio: round(Math.max(...temporarySpaceRatio)),
      },
    };
    const gates = {
      minimumRuns: {
        expected: releaseMinimumRuns,
        actual: trials.length,
        passed: trials.length >= releaseMinimumRuns,
      },
      minimumFixtureBytes: {
        expected: releaseMinimumFixtureBytes,
        actual: baseDatabaseBytes,
        passed: baseDatabaseBytes >= releaseMinimumFixtureBytes,
      },
      p95TotalMilliseconds: {
        maximum: options.maxP95Milliseconds,
        actual: summary.totalMilliseconds.p95,
        passed: summary.totalMilliseconds.p95 <= options.maxP95Milliseconds,
      },
      maximumWriteLockMilliseconds: {
        maximum: options.maxWriteLockMilliseconds,
        actual: summary.writeLockMilliseconds.max,
        passed: summary.writeLockMilliseconds.max <= options.maxWriteLockMilliseconds,
      },
      maximumTemporarySpaceRatio: {
        maximum: options.maxTemporarySpaceRatio,
        actual: summary.temporarySpace.maxRatio,
        passed: summary.temporarySpace.maxRatio <= options.maxTemporarySpaceRatio,
      },
    };
    const qualified = Object.values(gates).every(gate => gate.passed);
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sourceCommit: process.env.KUMA_MIERU_BENCHMARK_COMMIT ?? 'unverified',
      environment: {
        runtime: process.version,
        platform: process.platform,
        architecture: process.arch,
        cpu: cpus()[0]?.model ?? 'unknown',
        logicalCpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
      },
      fixture: {
        fromSchemaVersion: fromVersion,
        toSchemaVersion: toVersion,
        databaseBytes: baseDatabaseBytes,
        auditRows: options.auditRows,
        signalRows: options.signalRows,
        mirroredEvents: options.mirroredRows,
        mirroredEventEntries: options.mirroredRows,
        nativeEvents: options.nativeEventRows,
        expectedLifecycleDueEvents,
        payloadBytes: Buffer.byteLength(payload),
      },
      budgets: {
        p95TotalMilliseconds: options.maxP95Milliseconds,
        maximumWriteLockMilliseconds: options.maxWriteLockMilliseconds,
        maximumTemporarySpaceRatio: options.maxTemporarySpaceRatio,
      },
      summary,
      gates,
      qualified,
      trials,
    };
    if (options.output) await writeReport(resolve(options.output), report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (options.profile === 'release' && !qualified) process.exitCode = 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

await run();

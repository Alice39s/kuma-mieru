import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import type { BackupService } from '../db/backup.js';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { createConfigModeTransitionService } from './mode-transition.js';
import { getDurableConfigState, hashConfig } from './repository.js';
import {
  hashConfigSource,
  loadRuntimeConfig,
  type RuntimeConfigSnapshot,
} from './runtime-config.js';

const fileConfig = (title: string) => `schemaVersion: 1
server: {}
sources:
  - id: primary
    kind: uptime-kuma
    baseUrl: https://status.example.com
    pageIds: [main]
pages:
  - id: public
    slug: main
    title: ${title}
    sourceRefs: [primary]
`;

const audit = {
  actorId: 'owner-1',
  requestId: 'request-1',
};

const fakeBackupService = (created: string[]): BackupService => ({
  create: async createdBy => {
    created.push(createdBy);
    return {
      backupId: 'bkp_00000000-0000-4000-8000-000000000001',
      valid: true,
      schemaVersion: 19,
      sizeBytes: 1,
      sha256: 'a'.repeat(64),
      createdAt: '2026-07-26T00:00:00.000Z',
    };
  },
  deleteEligible: async () => ({ backupId: '', deletedAt: '' }),
  list: () => [],
  validate: async backupId => ({
    backupId,
    valid: true,
    schemaVersion: 19,
    sizeBytes: 1,
    sha256: 'a'.repeat(64),
    createdAt: '2026-07-26T00:00:00.000Z',
  }),
  recoverInterrupted: async () => 0,
});

const createFixture = async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-config-transition-'));
  const databasePath = resolve(directory, 'kuma-mieru.sqlite3');
  const filePath = resolve(directory, 'config.yml');
  await writeFile(filePath, fileConfig('File mode'), { mode: 0o600 });
  const { database } = openDatabase(databasePath);
  await migrateDatabase(database, {
    directory: resolve(process.cwd(), 'migrations'),
    databasePath,
    appBuild: '2.0.0-test',
  });
  let runtime = await loadRuntimeConfig({ database, environment: {} });
  const backups: string[] = [];
  const applied: RuntimeConfigSnapshot[] = [];
  const service = createConfigModeTransitionService({
    database,
    backupService: fakeBackupService(backups),
    allowedFilePath: filePath,
    currentSnapshot: () => runtime,
    applySnapshot: snapshot => {
      runtime = snapshot;
      applied.push(snapshot);
    },
  });
  return {
    directory,
    database,
    filePath,
    backups,
    applied,
    service,
    runtime: () => runtime,
    setRuntime: (snapshot: RuntimeConfigSnapshot) => {
      runtime = snapshot;
    },
  };
};

test('previews and atomically applies managed to file with a one-time token', async () => {
  const fixture = await createFixture();
  try {
    const content = `${fileConfig('File mode')}dataLifecycle:
  retention:
    eventDraftDays: 90
    adminAuditDays: 365
    deliveryAttemptDays: 90
    backupDays: 30
`;
    await writeFile(fixture.filePath, content, { mode: 0o600 });
    const sourceHash = hashConfigSource(content);
    const preview = await fixture.service.preview(
      {
        schemaVersion: '1.0',
        from: 'managed',
        to: 'file',
        expectedActiveRevision: fixture.runtime().revision ?? 0,
        source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
        dryRun: true,
      },
      audit
    );
    assert.equal(preview.sourceHash, sourceHash);
    assert.deepEqual(preview.diff.pages.added, ['public']);
    assert.deepEqual(preview.diff.settings.added, ['dataLifecycle']);
    assert.equal(fixture.runtime().mode, 'managed');
    assert.equal(fixture.backups.length, 0);

    const applied = await fixture.service.apply(
      {
        schemaVersion: '1.0',
        from: 'managed',
        to: 'file',
        expectedActiveRevision: fixture.runtime().revision ?? 0,
        source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
        dryRun: false,
        previewToken: preview.previewToken,
      },
      audit
    );
    assert.equal(applied.mode, 'file');
    assert.equal(applied.revision, null);
    assert.equal(fixture.runtime().mode, 'file');
    assert.equal(fixture.runtime().config.pages[0]?.title, 'File mode');
    assert.deepEqual(fixture.backups, ['owner-1']);
    assert.equal(getDurableConfigState(fixture.database).mode, 'file');
    assert.equal(fixture.service.status()?.state, 'completed');
    const consumedPreview = fixture.database
      .prepare(
        `SELECT consumed_at, target_config_json
         FROM config_transition_previews WHERE token_hash IS NOT NULL`
      )
      .get() as { consumed_at: string | null; target_config_json: string };
    assert.ok(consumedPreview.consumed_at);
    assert.equal(consumedPreview.target_config_json, 'null');
  } finally {
    fixture.database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('rejects file drift after preview without creating a backup or changing runtime', async () => {
  const fixture = await createFixture();
  try {
    const original = fileConfig('File mode');
    const sourceHash = hashConfigSource(original);
    const revision = fixture.runtime().revision ?? 0;
    const preview = await fixture.service.preview(
      {
        schemaVersion: '1.0',
        from: 'managed',
        to: 'file',
        expectedActiveRevision: revision,
        source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
        dryRun: true,
      },
      audit
    );
    await writeFile(fixture.filePath, fileConfig('Drifted'), { mode: 0o600 });
    await assert.rejects(
      fixture.service.apply(
        {
          schemaVersion: '1.0',
          from: 'managed',
          to: 'file',
          expectedActiveRevision: revision,
          source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
          dryRun: false,
          previewToken: preview.previewToken,
        },
        audit
      ),
      error => {
        assert.equal(
          typeof error === 'object' && error && 'code' in error ? error.code : null,
          'config_source_hash_drift'
        );
        return true;
      }
    );
    assert.equal(fixture.runtime().mode, 'managed');
    assert.equal(fixture.backups.length, 0);
  } finally {
    fixture.database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('binds a preview token to the administrator that created it', async () => {
  const fixture = await createFixture();
  try {
    const sourceHash = hashConfigSource(fileConfig('File mode'));
    const revision = fixture.runtime().revision ?? 0;
    const preview = await fixture.service.preview(
      {
        schemaVersion: '1.0',
        from: 'managed',
        to: 'file',
        expectedActiveRevision: revision,
        source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
        dryRun: true,
      },
      { ...audit, actorId: 'editor-1' }
    );

    await assert.rejects(
      fixture.service.apply(
        {
          schemaVersion: '1.0',
          from: 'managed',
          to: 'file',
          expectedActiveRevision: revision,
          source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
          dryRun: false,
          previewToken: preview.previewToken,
        },
        audit
      ),
      error => {
        assert.equal(
          typeof error === 'object' && error && 'code' in error ? error.code : null,
          'config_preview_actor_mismatch'
        );
        return true;
      }
    );
    assert.equal(fixture.backups.length, 0);
    assert.equal(fixture.runtime().mode, 'managed');
  } finally {
    fixture.database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('physically removes an unconsumed preview after its bounded lifetime', async () => {
  const fixture = await createFixture();
  try {
    let currentTime = new Date('2026-07-26T00:00:00.000Z');
    const service = createConfigModeTransitionService({
      database: fixture.database,
      backupService: fakeBackupService(fixture.backups),
      allowedFilePath: fixture.filePath,
      currentSnapshot: fixture.runtime,
      applySnapshot: fixture.setRuntime,
      now: () => currentTime,
    });
    const sourceHash = hashConfigSource(fileConfig('File mode'));
    await service.preview(
      {
        schemaVersion: '1.0',
        from: 'managed',
        to: 'file',
        expectedActiveRevision: fixture.runtime().revision ?? 0,
        source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
        dryRun: true,
      },
      audit
    );
    currentTime = new Date('2026-07-26T00:11:00.000Z');
    assert.equal(service.cleanupExpiredPreviews(), 1);
    assert.equal(
      (
        fixture.database
          .prepare('SELECT COUNT(*) AS count FROM config_transition_previews')
          .get() as { count: number }
      ).count,
      0
    );
  } finally {
    fixture.database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('restores the durable pointer and last-known-good when runtime activation fails', async () => {
  const fixture = await createFixture();
  try {
    const sourceHash = hashConfigSource(fileConfig('File mode'));
    const revision = fixture.runtime().revision ?? 0;
    let resumed = 0;
    const service = createConfigModeTransitionService({
      database: fixture.database,
      backupService: fakeBackupService(fixture.backups),
      allowedFilePath: fixture.filePath,
      currentSnapshot: fixture.runtime,
      applySnapshot: snapshot => {
        fixture.setRuntime(snapshot);
        if (snapshot.mode === 'file') {
          throw Object.assign(new Error('Injected runtime activation failure'), {
            code: 'runtime_activation_failed',
          });
        }
      },
      resumeRuntime: () => {
        resumed += 1;
      },
    });
    const preview = await service.preview(
      {
        schemaVersion: '1.0',
        from: 'managed',
        to: 'file',
        expectedActiveRevision: revision,
        source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
        dryRun: true,
      },
      audit
    );

    await assert.rejects(
      service.apply(
        {
          schemaVersion: '1.0',
          from: 'managed',
          to: 'file',
          expectedActiveRevision: revision,
          source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
          dryRun: false,
          previewToken: preview.previewToken,
        },
        audit
      ),
      /Injected runtime activation failure/u
    );

    const durable = getDurableConfigState(fixture.database);
    assert.equal(durable.mode, 'managed');
    assert.equal(durable.managedRevision, revision);
    assert.equal(durable.fileRevision, null);
    assert.equal(service.status()?.state, 'failed');
    assert.equal(service.status()?.errorCode, 'runtime_activation_failed');
    assert.equal(fixture.runtime().mode, 'managed');
    assert.equal(fixture.backups.length, 1);
    assert.equal(resumed, 0);
  } finally {
    fixture.database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('resumes the active runtime when quiescing a transition fails', async () => {
  const fixture = await createFixture();
  try {
    const sourceHash = hashConfigSource(fileConfig('File mode'));
    const revision = fixture.runtime().revision ?? 0;
    let resumed = 0;
    const service = createConfigModeTransitionService({
      database: fixture.database,
      backupService: fakeBackupService(fixture.backups),
      allowedFilePath: fixture.filePath,
      currentSnapshot: fixture.runtime,
      applySnapshot: fixture.setRuntime,
      quiesceRuntime: () => {
        throw Object.assign(new Error('Injected quiesce failure'), {
          code: 'runtime_quiesce_failed',
        });
      },
      resumeRuntime: () => {
        resumed += 1;
      },
    });
    const preview = await service.preview(
      {
        schemaVersion: '1.0',
        from: 'managed',
        to: 'file',
        expectedActiveRevision: revision,
        source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
        dryRun: true,
      },
      audit
    );

    await assert.rejects(
      service.apply(
        {
          schemaVersion: '1.0',
          from: 'managed',
          to: 'file',
          expectedActiveRevision: revision,
          source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
          dryRun: false,
          previewToken: preview.previewToken,
        },
        audit
      ),
      /Injected quiesce failure/u
    );

    assert.equal(resumed, 1);
    assert.equal(fixture.runtime().mode, 'managed');
    assert.equal(getDurableConfigState(fixture.database).mode, 'managed');
    assert.equal(fixture.backups.length, 1);
    assert.equal(service.status(), null);
  } finally {
    fixture.database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('single-flights apply before backup and rejects a concurrent transition', async () => {
  const fixture = await createFixture();
  try {
    const sourceHash = hashConfigSource(fileConfig('File mode'));
    const revision = fixture.runtime().revision ?? 0;
    const baseBackupService = fakeBackupService(fixture.backups);
    let releaseBackup: () => void = () => undefined;
    const backupGate = new Promise<void>(resolveGate => {
      releaseBackup = resolveGate;
    });
    const service = createConfigModeTransitionService({
      database: fixture.database,
      backupService: {
        ...baseBackupService,
        create: async createdBy => {
          const artifact = await baseBackupService.create(createdBy);
          await backupGate;
          return artifact;
        },
      },
      allowedFilePath: fixture.filePath,
      currentSnapshot: fixture.runtime,
      applySnapshot: snapshot => {
        fixture.setRuntime(snapshot);
        fixture.applied.push(snapshot);
      },
    });
    const preview = await service.preview(
      {
        schemaVersion: '1.0',
        from: 'managed',
        to: 'file',
        expectedActiveRevision: revision,
        source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
        dryRun: true,
      },
      audit
    );
    const request = {
      schemaVersion: '1.0' as const,
      from: 'managed' as const,
      to: 'file' as const,
      expectedActiveRevision: revision,
      source: { kind: 'file' as const, path: fixture.filePath, sha256: sourceHash },
      dryRun: false as const,
      previewToken: preview.previewToken,
    };

    const firstApply = service.apply(request, audit);
    assert.throws(
      () => service.apply(request, audit),
      error => {
        assert.equal(
          typeof error === 'object' && error && 'code' in error ? error.code : null,
          'config_transition_in_progress'
        );
        return true;
      }
    );
    releaseBackup();
    await firstApply;
    assert.equal(fixture.backups.length, 1);
  } finally {
    fixture.database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('imports the active file snapshot into a new managed revision and recovers pending state', async () => {
  const fixture = await createFixture();
  try {
    const sourceHash = hashConfigSource(fileConfig('File mode'));
    const initialManagedRevision = fixture.runtime().revision ?? 0;
    const toFile = await fixture.service.preview(
      {
        schemaVersion: '1.0',
        from: 'managed',
        to: 'file',
        expectedActiveRevision: initialManagedRevision,
        source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
        dryRun: true,
      },
      audit
    );
    await fixture.service.apply(
      {
        schemaVersion: '1.0',
        from: 'managed',
        to: 'file',
        expectedActiveRevision: initialManagedRevision,
        source: { kind: 'file', path: fixture.filePath, sha256: sourceHash },
        dryRun: false,
        previewToken: toFile.previewToken,
      },
      audit
    );

    const managedBaseRevision = getDurableConfigState(fixture.database).managedRevision;
    assert.ok(managedBaseRevision);
    const toManaged = await fixture.service.preview(
      {
        schemaVersion: '1.0',
        from: 'file',
        to: 'managed',
        expectedActiveRevision: 0,
        source: { kind: 'managed', revision: managedBaseRevision },
        dryRun: true,
      },
      audit
    );
    const applied = await fixture.service.apply(
      {
        schemaVersion: '1.0',
        from: 'file',
        to: 'managed',
        expectedActiveRevision: 0,
        source: { kind: 'managed', revision: managedBaseRevision },
        dryRun: false,
        previewToken: toManaged.previewToken,
      },
      audit
    );
    assert.equal(applied.mode, 'managed');
    assert.ok((applied.revision ?? 0) > managedBaseRevision);
    assert.equal(fixture.runtime().revision, applied.revision);
    assert.equal(fixture.runtime().contentHash, hashConfig(fixture.runtime().config));

    fixture.database
      .prepare(
        `UPDATE config_transitions
         SET state = 'pending', completed_at = NULL
         WHERE id = ?`
      )
      .run(applied.transitionId);
    const recovered = fixture.service.recoverPending();
    assert.equal(recovered?.transitionId, applied.transitionId);
    assert.equal(recovered?.recovered, true);
    assert.equal(fixture.service.status()?.state, 'completed');
  } finally {
    fixture.database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

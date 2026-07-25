import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { parsePrivateAddressCidrs } from './adapters/http-client.js';
import { getMetricWindowStates } from './adapters/metric-store.js';
import { getMethodologyState } from './adapters/methodology-store.js';
import { startSourcePoller } from './adapters/source-poller.js';
import { getSourceSnapshotState } from './adapters/source-store.js';
import { createSourceTestService } from './adapters/source-test.js';
import { createAuth } from './auth/auth.js';
import { createBootstrapService } from './auth/bootstrap.js';
import { loadOrCreateAuthSecret } from './auth/secret.js';
import { loadRuntimeConfig } from './config/runtime-config.js';
import { extendRetentionPolicy, resolveRetentionPolicy } from './config/schema.js';
import { createFileConfigReloader } from './config/file-reloader.js';
import { openDatabase } from './db/database.js';
import { createBackupService, startBackupScheduler } from './db/backup.js';
import { migrateDatabase } from './db/migrator.js';
import { acquireRuntimeLock } from './db/runtime-lock.js';
import { createDeliveryRuntime } from './delivery/runtime.js';
import { createSmtpTestService } from './delivery/smtp-config.js';
import { loadOrCreateSecretKeyring } from './secrets/keyring.js';
import { createSecretStore } from './secrets/store.js';
import { createPiiProtector } from './subscriptions/crypto.js';
import { createRetentionService, startRetentionScheduler } from './retention/service.js';
import { createSubscriberTombstoneStore } from './retention/tombstone-store.js';
import {
  clearPostRestoreRetentionMarker,
  readPostRestoreRetentionMarker,
} from './retention/restore-marker.js';
import {
  assertReleaseBuild,
  assertReleaseSchema,
  loadReleaseManifest,
} from './release/manifest.js';
import { createOgImageService } from './og/service.js';
import { createIconProxyService } from './icon/service.js';

const currentDirectory = fileURLToPath(new URL('.', import.meta.url));
const dataDirectory = resolve(process.env.KUMA_MIERU_DATA_DIR ?? './data');
const databasePath = resolve(dataDirectory, 'kuma-mieru.sqlite3');
const bundledMigrationDirectory = resolve(currentDirectory, 'migrations');
const migrationDirectory = process.env.KUMA_MIERU_MIGRATIONS_DIR
  ? resolve(process.env.KUMA_MIERU_MIGRATIONS_DIR)
  : existsSync(bundledMigrationDirectory)
    ? bundledMigrationDirectory
    : resolve(process.cwd(), 'migrations');
const clientDirectory = resolve(currentDirectory, '../client');
const ogImageService = createOgImageService({
  fallbackPath: resolve(clientDirectory, 'opengraph.png'),
});
const releaseManifest = await loadReleaseManifest(
  resolve(currentDirectory, '../release-manifest.json'),
  { required: process.env.NODE_ENV === 'production' }
);
const buildVersion =
  process.env.KUMA_MIERU_BUILD_VERSION ?? releaseManifest?.version ?? '2.0.0-dev';
if (releaseManifest) assertReleaseBuild(releaseManifest, buildVersion);
const port = Number(process.env.PORT ?? 3882);
const hostname = process.env.HOST ?? '0.0.0.0';
const baseURL = process.env.KUMA_MIERU_BASE_URL ?? `http://127.0.0.1:${port}`;
const trustedOrigins = (process.env.KUMA_MIERU_TRUSTED_ORIGINS ?? baseURL)
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const privateAddressCidrs = parsePrivateAddressCidrs(process.env.KUMA_MIERU_PRIVATE_SOURCE_CIDRS);
const iconProxyService = createIconProxyService({ privateAddressCidrs });

const runtimeLock = await acquireRuntimeLock({
  dataDirectory,
  appBuild: buildVersion,
});
const { database } = openDatabase(databasePath);
const migration = await migrateDatabase(database, {
  directory: migrationDirectory,
  databasePath,
  appBuild: buildVersion,
});
if (releaseManifest) {
  assertReleaseSchema(releaseManifest, migration.currentVersion);
}
const backupService = createBackupService({
  database,
  databasePath,
  dataDirectory,
  migrationDirectory,
  appBuild: buildVersion,
});
const interruptedBackups = await backupService.recoverInterrupted();
if (interruptedBackups > 0) {
  console.warn('Recovered interrupted backup records', { count: interruptedBackups });
}
const stopBackupScheduler =
  process.env.KUMA_MIERU_BACKUP_SCHEDULE_ENABLED === 'false'
    ? () => undefined
    : startBackupScheduler({ service: backupService });
const secretKeyring = await loadOrCreateSecretKeyring(dataDirectory);
const secretStore = createSecretStore(database, secretKeyring);
let runtimeSnapshot = await loadRuntimeConfig({ database });
const authSecret = await loadOrCreateAuthSecret(dataDirectory);
const auth = createAuth({ database, baseURL, secret: authSecret, trustedOrigins });
const piiProtector = createPiiProtector(authSecret);
const subscriberTombstones = createSubscriberTombstoneStore(dataDirectory);
const postRestoreMarker = await readPostRestoreRetentionMarker(dataDirectory);
const retentionService = createRetentionService({
  database,
  policy: () =>
    extendRetentionPolicy(
      resolveRetentionPolicy(runtimeSnapshot.config.dataLifecycle?.retention),
      postRestoreMarker?.retentionPolicy
    ),
  tombstones: subscriberTombstones,
});
if (postRestoreMarker) {
  const run = await retentionService.run('restore', `system:restore:${postRestoreMarker.backupId}`);
  await clearPostRestoreRetentionMarker(dataDirectory);
  console.info('Post-restore retention completed', {
    runId: run.id,
    backupId: postRestoreMarker.backupId,
  });
} else {
  const appliedTombstones = subscriberTombstones.apply(database);
  if (appliedTombstones > 0) {
    console.info('Applied subscriber tombstones', { count: appliedTombstones });
  }
}
const stopRetentionScheduler =
  process.env.KUMA_MIERU_RETENTION_SCHEDULE_ENABLED === 'false'
    ? () => undefined
    : startRetentionScheduler({ service: retentionService });
const smtpTest = createSmtpTestService({
  secret: authSecret,
  secretStore,
});
const deliveryRuntime = createDeliveryRuntime({
  database,
  protector: piiProtector,
  secretStore,
  tombstones: subscriberTombstones,
});
const sourceTest = createSourceTestService({
  secret: authSecret,
  privateAddressCidrs,
  secretStore,
});
if (runtimeSnapshot.mode === 'file') {
  for (const source of runtimeSnapshot.config.sources) await sourceTest.test(source);
}
let stopSourcePoller = startSourcePoller({
  database,
  config: runtimeSnapshot.config,
  secretStore,
  privateAddressCidrs,
});
deliveryRuntime.apply(runtimeSnapshot.config);
const applyRuntimeSnapshot = (nextSnapshot: typeof runtimeSnapshot) => {
  const stopNextPoller = startSourcePoller({
    database,
    config: nextSnapshot.config,
    secretStore,
    privateAddressCidrs,
  });
  const stopPreviousPoller = stopSourcePoller;
  deliveryRuntime.apply(nextSnapshot.config);
  runtimeSnapshot = nextSnapshot;
  stopSourcePoller = stopNextPoller;
  stopPreviousPoller();
};
const fileReloader =
  runtimeSnapshot.mode === 'file'
    ? createFileConfigReloader({
        path: resolve(process.env.KUMA_MIERU_CONFIG as string),
        initialSnapshot: runtimeSnapshot,
        validateConfig: async config => {
          for (const source of config.sources) await sourceTest.test(source);
          if (config.delivery?.smtp?.enabled) await smtpTest.test(config.delivery.smtp);
        },
        applySnapshot: applyRuntimeSnapshot,
      })
    : null;
const stopFileReloader = fileReloader?.start() ?? (() => undefined);
const reloadOnSighup = () => {
  if (!fileReloader) {
    console.info('Ignoring SIGHUP because configuration is not in file mode');
    return;
  }
  void fileReloader.check({ force: true }).then(result => {
    console.info('File configuration reload completed', {
      outcome: result.outcome,
      errorCode: result.status.lastErrorCode,
    });
  });
};
process.on('SIGHUP', reloadOnSighup);
const bootstrap = createBootstrapService({
  database,
  auth,
  providedToken: process.env.KUMA_MIERU_SETUP_TOKEN,
});
const setup = bootstrap.initialize();
if (setup) {
  console.warn(`Kuma Mieru owner setup token (expires ${setup.expiresAt}): ${setup.token}`);
}
const app = createApp({
  snapshot: runtimeSnapshot,
  getRuntimeSnapshot: () => runtimeSnapshot,
  getFileReloadStatus: fileReloader ? () => fileReloader.status() : undefined,
  reloadFileConfig: fileReloader ? () => fileReloader.check({ force: true }) : undefined,
  schemaVersion: migration.currentVersion,
  buildVersion,
  database,
  auth,
  authSecret,
  trustedOrigins,
  bootstrap,
  sourceTest,
  smtpTest,
  getDeliveryRuntimeStatus: deliveryRuntime.status,
  isEmailDeliveryEnabled: () => deliveryRuntime.status().state === 'running',
  secretStore,
  backupService,
  retentionService,
  subscriberTombstones,
  isRuntimeLockHeld: runtimeLock.isHeld,
  releaseManifest,
  ogImageService,
  iconProxyService,
  publicDirectory: process.env.NODE_ENV === 'development' ? undefined : clientDirectory,
  loadPageSnapshots: page =>
    page.sourceRefs.flatMap(sourceId => {
      const source = runtimeSnapshot.config.sources.find(candidate => candidate.id === sourceId);
      if (!source) return [];
      return source.pageIds.flatMap(pageId => {
        const state = getSourceSnapshotState(database, sourceId, pageId);
        return state ? [state] : [];
      });
    }),
  loadPageMetricWindows: page =>
    page.sourceRefs.flatMap(sourceId => {
      const source = runtimeSnapshot.config.sources.find(candidate => candidate.id === sourceId);
      if (!source) return [];
      return source.pageIds.flatMap(pageId => getMetricWindowStates(database, sourceId, pageId));
    }),
  loadPageMethodologies: page =>
    page.sourceRefs.flatMap(sourceId => {
      const source = runtimeSnapshot.config.sources.find(candidate => candidate.id === sourceId);
      if (!source) return [];
      return source.pageIds.flatMap(pageId => {
        const state = getMethodologyState(database, sourceId, pageId);
        return state ? [state] : [];
      });
    }),
  onManagedRevision: revision => {
    const nextSnapshot = {
      mode: 'managed' as const,
      revision: revision.revision,
      contentHash: revision.contentHash,
      loadedAt: new Date().toISOString(),
      config: revision.config,
    };
    applyRuntimeSnapshot(nextSnapshot);
  },
});

const server = serve({ fetch: app.fetch, port, hostname });
console.info(`Kuma Mieru v2 listening on http://${hostname}:${port}`);

const shutdown = (signal: NodeJS.Signals) => {
  console.info(`Received ${signal}; shutting down`);
  server.close(() => {
    process.removeListener('SIGHUP', reloadOnSighup);
    stopFileReloader();
    stopSourcePoller();
    stopBackupScheduler();
    stopRetentionScheduler();
    deliveryRuntime.stop();
    try {
      subscriberTombstones.close();
      database.close();
    } finally {
      runtimeLock.release();
      process.exit(0);
    }
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { startSourcePoller } from './adapters/source-poller.js';
import { getSourceSnapshotState } from './adapters/source-store.js';
import { createSourceTestService } from './adapters/source-test.js';
import { createAuth } from './auth/auth.js';
import { createBootstrapService } from './auth/bootstrap.js';
import { loadOrCreateAuthSecret } from './auth/secret.js';
import { loadRuntimeConfig } from './config/runtime-config.js';
import { openDatabase } from './db/database.js';
import { migrateDatabase } from './db/migrator.js';
import { loadOrCreateSecretKeyring } from './secrets/keyring.js';
import { createSecretStore } from './secrets/store.js';

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
const buildVersion = process.env.KUMA_MIERU_BUILD_VERSION ?? '2.0.0-dev';
const port = Number(process.env.PORT ?? 3882);
const hostname = process.env.HOST ?? '0.0.0.0';
const baseURL = process.env.KUMA_MIERU_BASE_URL ?? `http://127.0.0.1:${port}`;
const trustedOrigins = (process.env.KUMA_MIERU_TRUSTED_ORIGINS ?? baseURL)
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const { database } = openDatabase(databasePath);
const migration = await migrateDatabase(database, {
  directory: migrationDirectory,
  databasePath,
  appBuild: buildVersion,
});
const secretKeyring = await loadOrCreateSecretKeyring(dataDirectory);
const secretStore = createSecretStore(database, secretKeyring);
let runtimeSnapshot = await loadRuntimeConfig({ database });
let stopSourcePoller = startSourcePoller({
  database,
  config: runtimeSnapshot.config,
  secretStore,
  allowPrivateAddresses: process.env.KUMA_MIERU_ALLOW_PRIVATE_SOURCES === 'true',
});
const authSecret = await loadOrCreateAuthSecret(dataDirectory);
const auth = createAuth({ database, baseURL, secret: authSecret, trustedOrigins });
const sourceTest = createSourceTestService({
  secret: authSecret,
  allowPrivateAddresses: process.env.KUMA_MIERU_ALLOW_PRIVATE_SOURCES === 'true',
  secretStore,
});
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
  schemaVersion: migration.currentVersion,
  buildVersion,
  database,
  auth,
  authSecret,
  trustedOrigins,
  bootstrap,
  sourceTest,
  secretStore,
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
  onManagedRevision: revision => {
    const nextSnapshot = {
      mode: 'managed' as const,
      revision: revision.revision,
      contentHash: revision.contentHash,
      loadedAt: new Date().toISOString(),
      config: revision.config,
    };
    const stopNextPoller = startSourcePoller({
      database,
      config: nextSnapshot.config,
      secretStore,
      allowPrivateAddresses: process.env.KUMA_MIERU_ALLOW_PRIVATE_SOURCES === 'true',
    });
    const stopPreviousPoller = stopSourcePoller;
    runtimeSnapshot = nextSnapshot;
    stopSourcePoller = stopNextPoller;
    stopPreviousPoller();
  },
});

const server = serve({ fetch: app.fetch, port, hostname });
console.info(`Kuma Mieru v2 listening on http://${hostname}:${port}`);

const shutdown = (signal: NodeJS.Signals) => {
  console.info(`Received ${signal}; shutting down`);
  server.close(() => {
    stopSourcePoller();
    database.close();
    process.exit(0);
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

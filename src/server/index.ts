import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { startSourcePoller } from './adapters/source-poller.js';
import { getSourceSnapshotState } from './adapters/source-store.js';
import { loadRuntimeConfig } from './config/runtime-config.js';
import { openDatabase } from './db/database.js';
import { migrateDatabase } from './db/migrator.js';

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

const { database } = openDatabase(databasePath);
const migration = await migrateDatabase(database, {
  directory: migrationDirectory,
  databasePath,
  appBuild: buildVersion,
});
const snapshot = await loadRuntimeConfig({ database });
const stopSourcePoller = startSourcePoller({
  database,
  config: snapshot.config,
  allowPrivateAddresses: process.env.KUMA_MIERU_ALLOW_PRIVATE_SOURCES === 'true',
});
const app = createApp({
  snapshot,
  schemaVersion: migration.currentVersion,
  buildVersion,
  publicDirectory: process.env.NODE_ENV === 'development' ? undefined : clientDirectory,
  loadPageSnapshots: page =>
    page.sourceRefs.flatMap(sourceId => {
      const source = snapshot.config.sources.find(candidate => candidate.id === sourceId);
      if (!source) return [];
      return source.pageIds.flatMap(pageId => {
        const state = getSourceSnapshotState(database, sourceId, pageId);
        return state ? [state] : [];
      });
    }),
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

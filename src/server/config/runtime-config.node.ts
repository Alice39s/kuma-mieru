import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRuntimeConfig } from './runtime-config.js';
import { openDatabase } from '../db/database.js';

const createDatabase = () => {
  const { database } = openDatabase(':memory:');
  database.exec(`
    CREATE TABLE config_revisions (
      revision INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      config_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      parent_revision INTEGER,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX config_revisions_content_hash_idx ON config_revisions(mode, content_hash);
    CREATE TABLE runtime_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  return database;
};

test('bootstraps an empty managed revision by default', async () => {
  const database = createDatabase();
  try {
    const snapshot = await loadRuntimeConfig({ database, environment: {} });
    assert.equal(snapshot.mode, 'managed');
    assert.equal(snapshot.revision, 1);
    assert.deepEqual(snapshot.config.pages, []);
  } finally {
    database.close();
  }
});

test('prefers UPTIME_KUMA_URLS in compatibility mode', async () => {
  const database = createDatabase();
  try {
    const snapshot = await loadRuntimeConfig({
      database,
      environment: {
        UPTIME_KUMA_URLS: 'https://status.example.com/status/main|https://cn.example.com/status/cn',
        UPTIME_KUMA_BASE_URL: 'https://ignored.example.com',
        PAGE_ID: 'ignored',
        KUMA_MIERU_TITLE: 'Example Status',
      },
    });
    assert.equal(snapshot.mode, 'compatibility');
    assert.equal(snapshot.config.sources.length, 2);
    assert.deepEqual(
      snapshot.config.pages.map(page => page.slug),
      ['main', 'cn']
    );
    assert.equal(snapshot.config.pages[0]?.title, 'Example Status');
  } finally {
    database.close();
  }
});

test('loads and validates file mode YAML', async () => {
  const database = createDatabase();
  try {
    const snapshot = await loadRuntimeConfig({
      database,
      environment: { KUMA_MIERU_CONFIG_MODE: 'file', KUMA_MIERU_CONFIG: '/config.yml' },
      readConfigFile: async () => `
schemaVersion: 1
server: {}
sources:
  - id: primary
    kind: uptime-kuma
    baseUrl: https://status.example.com
    pageIds: [main]
pages:
  - id: public
    slug: main
    title: Example Status
    sourceRefs: [primary]
`,
    });
    assert.equal(snapshot.mode, 'file');
    assert.equal(snapshot.revision, null);
    assert.equal(snapshot.config.pages[0]?.slug, 'main');
  } finally {
    database.close();
  }
});

test('rejects a page that references an unknown source', async () => {
  const database = createDatabase();
  try {
    await assert.rejects(
      loadRuntimeConfig({
        database,
        environment: { KUMA_MIERU_CONFIG_MODE: 'file', KUMA_MIERU_CONFIG: '/config.yml' },
        readConfigFile: async () => `
schemaVersion: 1
server: {}
sources: []
pages:
  - id: public
    slug: main
    title: Example Status
    sourceRefs: [missing]
`,
      }),
      /Unknown source reference/u
    );
  } finally {
    database.close();
  }
});

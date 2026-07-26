import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  loadRuntimeConfig,
  maximumConfigFileBytes,
  readRegularConfigFile,
} from './runtime-config.js';
import { getDurableConfigState } from './repository.js';
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
    assert.equal(getDurableConfigState(database).mode, 'managed');
    const rebooted = await loadRuntimeConfig({
      database,
      environment: { UPTIME_KUMA_BASE_URL: 'https://legacy.example.com' },
    });
    assert.equal(rebooted.mode, 'managed');
    assert.equal(rebooted.revision, snapshot.revision);
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
        FEATURE_TITLE: 'Ignored title',
        SSR_STRICT_MODE: 'true',
      },
    });
    assert.equal(snapshot.mode, 'compatibility');
    assert.equal(snapshot.config.sources.length, 2);
    assert.deepEqual(
      snapshot.config.pages.map(page => page.slug),
      ['main', 'cn']
    );
    assert.equal(snapshot.config.pages[0]?.title, 'Example Status');
    assert.equal(snapshot.compatibility?.conflicts.length, 1);
    assert.equal(
      snapshot.compatibility?.decisions.find(item => item.key === 'FEATURE_TITLE')?.status,
      'ignored_by_precedence'
    );
    assert.deepEqual(snapshot.compatibility?.ignoredFields, ['SSR_STRICT_MODE']);
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
    assert.equal(getDurableConfigState(database).mode, 'file');
    const rebooted = await loadRuntimeConfig({
      database,
      environment: {},
      readConfigFile: async () => {
        throw new Error('Durable last-known-good must not re-read the file during bootstrap');
      },
    });
    assert.equal(rebooted.mode, 'file');
    assert.equal(rebooted.contentHash, snapshot.contentHash);
    assert.equal(rebooted.filePath, '/config.yml');
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

test('reads the opened regular file and rejects a symbolic-link config path', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-config-file-'));
  const target = resolve(directory, 'target.yml');
  const link = resolve(directory, 'config.yml');
  const oversized = resolve(directory, 'oversized.yml');
  try {
    await writeFile(target, 'schemaVersion: 1\nserver: {}\nsources: []\npages: []\n', {
      mode: 0o600,
    });
    await symlink(target, link);
    assert.match(await readRegularConfigFile(target), /schemaVersion/u);
    await assert.rejects(readRegularConfigFile(link));
    await writeFile(oversized, Buffer.alloc(maximumConfigFileBytes + 1), { mode: 0o600 });
    await assert.rejects(readRegularConfigFile(oversized), /must not exceed 2 MiB/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

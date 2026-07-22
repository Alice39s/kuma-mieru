import assert from 'node:assert/strict';
import test from 'node:test';
import { hashConfig } from './repository.js';
import { createFileConfigReloader } from './file-reloader.js';
import type { CanonicalConfig } from './schema.js';
import type { RuntimeConfigSnapshot } from './runtime-config.js';

const config = (title: string): CanonicalConfig => ({
  schemaVersion: 1,
  server: {},
  sources: [
    {
      id: 'primary',
      kind: 'uptime-kuma',
      baseUrl: 'https://status.example.com',
      pageIds: ['main'],
    },
  ],
  pages: [{ id: 'public', slug: 'main', title, sourceRefs: ['primary'] }],
});

const yaml = (title: string) => `
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
    title: ${title}
    sourceRefs: [primary]
`;

const initialSnapshot = (): RuntimeConfigSnapshot => ({
  mode: 'file',
  revision: null,
  contentHash: hashConfig(config('Before')),
  loadedAt: '2026-07-23T00:00:00.000Z',
  config: config('Before'),
});

test('validates and atomically applies a changed file snapshot once', async () => {
  const applied: RuntimeConfigSnapshot[] = [];
  let validations = 0;
  const reloader = createFileConfigReloader({
    path: '/config.yml',
    initialSnapshot: initialSnapshot(),
    readConfigFile: async () => yaml('After'),
    statConfigFile: async () => ({ mtimeMs: 2, size: 200 }),
    validateConfig: async value => {
      validations += 1;
      assert.equal(value.pages[0]?.title, 'After');
    },
    applySnapshot: async snapshot => {
      applied.push(snapshot);
    },
  });

  assert.equal((await reloader.check()).outcome, 'applied');
  assert.equal((await reloader.check()).outcome, 'unchanged');
  assert.equal(validations, 1);
  assert.equal(applied.length, 1);
  assert.equal(applied[0]?.config.pages[0]?.title, 'After');
  assert.equal(reloader.status().state, 'ready');
});

test('retains last-known-good after a partial file write and retries the same stat', async () => {
  let content = 'schemaVersion: [partial';
  let applied = 0;
  const reloader = createFileConfigReloader({
    path: '/config.yml',
    initialSnapshot: initialSnapshot(),
    readConfigFile: async () => content,
    statConfigFile: async () => ({ mtimeMs: 2, size: content.length }),
    applySnapshot: async () => {
      applied += 1;
    },
  });

  const failed = await reloader.check();
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.status.lastErrorCode, 'config_invalid');
  assert.equal(failed.status.failedHash?.length, 64);
  content = yaml('Recovered');
  assert.equal((await reloader.check()).outcome, 'applied');
  assert.equal(applied, 1);
});

test('retains last-known-good when source dry-run fails and single-flights checks', async () => {
  let releaseValidation: (() => void) | undefined;
  let validations = 0;
  let applied = 0;
  const reloader = createFileConfigReloader({
    path: '/config.yml',
    initialSnapshot: initialSnapshot(),
    readConfigFile: async () => yaml('After'),
    statConfigFile: async () => ({ mtimeMs: 2, size: 200 }),
    validateConfig: async () => {
      validations += 1;
      await new Promise<void>(resolve => {
        releaseValidation = resolve;
      });
      throw new Error('source unavailable');
    },
    applySnapshot: async () => {
      applied += 1;
    },
  });

  const first = reloader.check();
  const second = reloader.check({ force: true });
  while (!releaseValidation) await new Promise(resolve => setImmediate(resolve));
  releaseValidation();
  assert.equal(first, second);
  assert.equal((await first).status.lastErrorCode, 'source_validation_failed');
  assert.equal(validations, 1);
  assert.equal(applied, 0);
});

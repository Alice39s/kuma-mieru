import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './app.js';

const snapshot = {
  mode: 'compatibility' as const,
  revision: null,
  contentHash: 'test-hash',
  loadedAt: '2026-07-23T00:00:00.000Z',
  config: {
    schemaVersion: 1 as const,
    server: {},
    sources: [
      {
        id: 'primary',
        kind: 'uptime-kuma' as const,
        baseUrl: 'https://status.example.com',
        pageIds: ['main'],
      },
    ],
    pages: [{ id: 'public', slug: 'main', title: 'Example Status', sourceRefs: ['primary'] }],
  },
};

test('exposes readiness, compatibility health and public metadata', async () => {
  const app = createApp({ snapshot, schemaVersion: 1, buildVersion: '2.0.0-test', startedAt: 0 });

  const ready = await app.request('/health/ready');
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), {
    status: 'ok',
    schemaVersion: 1,
    configMode: 'compatibility',
  });

  const health = await app.request('/api/health');
  assert.equal(health.headers.get('cache-control'), 'no-store');

  const pages = await app.request('/api/v1/public/pages');
  assert.equal(pages.status, 200);
  const pagesBody = (await pages.json()) as { data: Array<Record<string, unknown>> };
  assert.deepEqual(pagesBody.data[0], {
    id: 'public',
    slug: 'main',
    title: 'Example Status',
    sourceRefs: ['primary'],
  });
});

test('returns a stable JSON error for unknown API routes', async () => {
  const app = createApp({ snapshot, schemaVersion: 1, buildVersion: '2.0.0-test' });
  const response = await app.request('/api/v1/missing');
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: 'NOT_FOUND', message: 'API route not found' },
  });
});

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
  const body = (await response.json()) as { error: Record<string, unknown> };
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(body.error.message, 'API route not found');
  assert.equal(typeof body.error.requestId, 'string');
});

test('returns 503 instead of fetching upstream when no local snapshot exists', async () => {
  const app = createApp({ snapshot, schemaVersion: 2, buildVersion: '2.0.0-test' });
  const response = await app.request('/api/v1/public/pages/main/snapshot');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '30');
  const body = (await response.json()) as { error: Record<string, unknown> };
  assert.equal(body.error.code, 'SOURCE_SNAPSHOT_UNAVAILABLE');
  assert.equal(body.error.message, 'No normalized source snapshot is available yet');
  assert.equal(typeof body.error.requestId, 'string');
});

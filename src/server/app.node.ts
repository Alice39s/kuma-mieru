import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import type { SourceSnapshotState } from './adapters/source-store.js';
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

test('serves generic native metrics only from the local extension cache', async () => {
  const app = createApp({
    snapshot,
    schemaVersion: 8,
    buildVersion: '2.0.0-test',
    loadPageMetricExtensions: () => [
      {
        sourceId: 'llm',
        pageId: 'default',
        fetchedAt: '2026-07-25T00:00:00Z',
        staleAfter: '2026-07-25T00:15:00Z',
        stale: false,
        extension: {
          catalog: [
            {
              id: 'latency',
              unit: 'milliseconds',
              minimumSamples: { p50: 10 },
              presentationHint: 'distribution',
            },
          ],
          series: [
            {
              metricId: 'latency',
              unit: 'milliseconds',
              window: '5m',
              generatedAt: '2026-07-25T00:00:00Z',
              points: [
                {
                  window: {
                    start: '2026-07-24T23:55:00Z',
                    end: '2026-07-25T00:00:00Z',
                  },
                  dimensions: { region: 'ap-northeast-tyo' },
                  protocolVersion: '1.0',
                  sampleCount: 10,
                  eligibleCount: 10,
                  value: { p50: 420 },
                  freshness: {
                    state: 'fresh',
                    observedAt: '2026-07-24T23:59:00Z',
                  },
                  coverageState: 'active',
                  limitations: [],
                },
              ],
            },
          ],
        },
      },
    ],
  });

  const catalog = await app.request('/api/v1/public/pages/main/metrics/catalog');
  assert.equal(catalog.status, 200);
  const catalogBody = (await catalog.json()) as {
    data: Array<{ sourceId: string; metrics: Array<{ id: string }> }>;
  };
  assert.equal(catalogBody.data[0]?.sourceId, 'llm');
  assert.equal(catalogBody.data[0]?.metrics[0]?.id, 'latency');

  const query = await app.request(
    '/api/v1/public/pages/main/metrics/query?source=llm&metric=latency&window=5m'
  );
  assert.equal(query.status, 200);
  const queryBody = (await query.json()) as {
    data: Array<{ points: Array<{ dimensions: Record<string, string> }> }>;
  };
  assert.equal(queryBody.data[0]?.points[0]?.dimensions.region, 'ap-northeast-tyo');

  const unsupportedWindow = await app.request(
    '/api/v1/public/pages/main/metrics/query?source=llm&metric=latency&window=2m'
  );
  assert.equal(unsupportedWindow.status, 400);
  const unknownParameter = await app.request(
    '/api/v1/public/pages/main/metrics/query?source=llm&metric=latency&window=5m&raw=true'
  );
  assert.equal(unknownParameter.status, 400);
  const repeatedMetric = await app.request(
    '/api/v1/public/pages/main/metrics/query?metric=latency&metric=throughput'
  );
  assert.equal(repeatedMetric.status, 400);

  const unavailable = await app.request(
    '/api/v1/public/pages/main/metrics/query?source=llm&metric=throughput&window=5m'
  );
  assert.equal(unavailable.status, 404);
  assert.equal(unavailable.headers.get('cache-control'), 'no-store');
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

  const legacyConfig = await app.request('/api/config');
  assert.equal(legacyConfig.status, 503);
  assert.equal(legacyConfig.headers.get('cache-control')?.startsWith('no-store'), true);
  const legacyConfigBody = (await legacyConfig.json()) as { success: boolean; status: string };
  assert.deepEqual(legacyConfigBody, {
    ...legacyConfigBody,
    success: false,
    status: 'all_failed',
  });
});

test('projects local snapshots into the v1 read APIs without an upstream request', async () => {
  const compatibleSnapshot = {
    ...snapshot,
    config: {
      ...snapshot.config,
      pages: [
        {
          ...snapshot.config.pages[0],
          description: 'Compatibility fixture',
          features: { editThisPage: true, showStarButton: true },
        },
      ],
    },
  };
  const sourceSnapshot: SourceSnapshotState = {
    snapshot: {
      sourceId: 'primary',
      pageId: 'main',
      title: 'Example Status',
      description: 'Compatibility fixture',
      status: 'degraded',
      fetchedAt: '2026-07-23T00:00:00.000Z',
      sourceUpdatedAt: '2026-07-23T00:00:00.000Z',
      extensions: {},
      capabilities: {
        currentStatus: true,
        heartbeatSeries: true,
        latencySeries: true,
        uptimeWindows: ['24h'],
        incidents: 'current',
        maintenance: true,
        groups: true,
        tags: true,
        nativeMetrics: false,
        historicalDays: 1,
      },
      groups: [{ id: 'group-1', name: 'Core', position: 0, serviceIds: ['api'] }],
      services: [
        {
          id: 'api',
          sourceId: 'primary',
          upstreamId: 'api',
          name: 'API',
          groupId: 'group-1',
          tags: [],
          status: 'operational',
          rawStatus: 1,
          latencyMs: 42,
          observedAt: '2026-07-23T00:00:00.000Z',
          uptime24h: 0.999,
        },
      ],
      incidents: [
        {
          id: 'incident-1',
          title: 'Latency',
          content: 'Monitoring',
          severity: 'warning',
          startedAt: '2026-07-23T00:00:00.000Z',
          updatedAt: null,
          rawStatus: 'investigating',
        },
      ],
    },
    health: {
      state: 'healthy',
      stale: false,
      staleAfter: '2026-07-23T00:03:00.000Z',
      lastSuccessAt: '2026-07-23T00:00:00.000Z',
      errorCode: null,
    },
  };
  const app = createApp({
    snapshot: compatibleSnapshot,
    schemaVersion: 7,
    buildVersion: '2.0.0-test',
    publicDirectory: resolve(process.cwd(), 'public'),
    loadPageSnapshots: () => [sourceSnapshot],
  });

  const config = await app.request('/api/config?pageId=unknown');
  const configBody = (await config.json()) as {
    config: { slug: string; description: string };
    incidents: unknown[];
    success: boolean;
    status: string;
  };
  assert.equal(config.status, 200);
  assert.equal(config.headers.get('deprecation'), 'true');
  assert.equal(configBody.config.slug, 'main');
  assert.equal(configBody.config.description, 'Compatibility fixture');
  assert.equal(configBody.incidents.length, 1);
  assert.equal(configBody.success, true);
  assert.equal(configBody.status, 'ok');

  const monitor = await app.request('/api/monitor?pageId=main');
  const monitorBody = (await monitor.json()) as {
    monitorGroups: Array<{ monitorList: Array<{ id: number; name: string }> }>;
    data: { heartbeatList: Record<string, Array<{ status: number; ping: number }>> };
  };
  assert.equal(monitor.status, 200);
  assert.deepEqual(monitorBody.monitorGroups[0]?.monitorList[0], {
    id: 1,
    name: 'API',
    sendUrl: 0,
    type: 'unknown',
  });
  assert.deepEqual(monitorBody.data.heartbeatList['1']?.[0], {
    status: 1,
    time: '2026-07-23T00:00:00.000Z',
    msg: 'operational',
    ping: 42,
  });

  const icon = await app.request('/api/icon?pageId=main');
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/svg+xml');
  assert.equal((await icon.arrayBuffer()).byteLength > 0, true);

  const manage = await app.request('/api/manage-status-page?pageId=main');
  assert.equal(manage.status, 307);
  assert.equal(manage.headers.get('location'), 'https://status.example.com/manage-status-page');
});

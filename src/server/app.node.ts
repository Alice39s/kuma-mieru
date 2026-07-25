import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import type { SourceSnapshotState } from './adapters/source-store.js';
import { createApp } from './app.js';
import { openDatabase } from './db/database.js';
import { migrateDatabase } from './db/migrator.js';
import { reconcileMirroredEvents } from './events/mirrored-repository.js';

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

const sourceState = (
  sourceId: string,
  status: SourceSnapshotState['snapshot']['status'],
  stale: boolean
): SourceSnapshotState => ({
  snapshot: {
    sourceId,
    pageId: 'main',
    title: `${sourceId} status`,
    description: '',
    status,
    fetchedAt: '2026-07-25T03:00:00.000Z',
    sourceUpdatedAt: null,
    extensions: {},
    capabilities: {
      currentStatus: true,
      heartbeatSeries: false,
      latencySeries: false,
      uptimeWindows: [],
      incidents: 'none',
      maintenance: false,
      groups: false,
      tags: false,
      nativeMetrics: false,
      historicalDays: null,
    },
    groups: [],
    services: [],
    incidents: [],
  },
  health: {
    state: stale ? 'stale' : 'healthy',
    stale,
    staleAfter: stale ? '2026-07-25T02:59:00.000Z' : '2026-07-25T04:00:00.000Z',
    lastSuccessAt: '2026-07-25T03:00:00.000Z',
    errorCode: stale ? 'upstream_timeout' : null,
  },
});

test('exposes readiness, compatibility health and public metadata', async () => {
  const app = createApp({ snapshot, schemaVersion: 1, buildVersion: '2.0.0-test', startedAt: 0 });

  const ready = await app.request('/health/ready');
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), {
    status: 'ok',
    schemaVersion: 1,
    configMode: 'compatibility',
    runtimeOwnership: 'exclusive',
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

test('fails readiness closed when exclusive runtime ownership is lost', async () => {
  const app = createApp({
    snapshot,
    schemaVersion: 1,
    buildVersion: '2.0.0-test',
    isRuntimeLockHeld: () => false,
  });
  const ready = await app.request('/health/ready');
  assert.equal(ready.status, 503);
  const body = (await ready.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'RUNTIME_LOCK_NOT_HELD');
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

test('canonicalizes public page paths and serves cacheable page-specific OG images', async () => {
  const calls: Array<{ pageId: string; view: string; status: string; stale: boolean }> = [];
  const app = createApp({
    snapshot,
    schemaVersion: 1,
    buildVersion: '2.0.0-test',
    loadPageSnapshots: () => [
      sourceState('stale-source', 'operational', true),
      sourceState('healthy-source', 'operational', false),
    ],
    ogImageService: {
      render: async input => {
        calls.push({
          pageId: input.pageId,
          view: input.view,
          status: input.status,
          stale: input.stale,
        });
        return {
          bytes: Buffer.from('png'),
          etag: '"og-etag"',
          source: calls.length === 1 ? 'rendered' : 'memory',
        };
      },
    },
  });

  const canonical = await app.request('/status/main?region=jp');
  assert.equal(canonical.status, 308);
  assert.equal(canonical.headers.get('location'), '/status/main/?region=jp');
  const legacy = await app.request('/public');
  assert.equal(legacy.status, 308);
  assert.equal(legacy.headers.get('location'), '/status/main/');
  const incidentDetail = await app.request('/status/main/incidents/incident-1?from=feed');
  assert.equal(incidentDetail.status, 308);
  assert.equal(
    incidentDetail.headers.get('location'),
    '/status/main/incidents/incident-1/?from=feed'
  );
  const maintenanceDetail = await app.request('/status/main/maintenance/window-1');
  assert.equal(maintenanceDetail.status, 308);
  assert.equal(maintenanceDetail.headers.get('location'), '/status/main/maintenance/window-1/');
  for (const view of ['history', 'notices', 'subscribe']) {
    const response = await app.request(`/status/main/${view}`);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), `/status/main/${view}/`);
  }
  const serviceDetail = await app.request('/status/main/service/api%2Fgateway?window=24h');
  assert.equal(serviceDetail.status, 308);
  assert.equal(
    serviceDetail.headers.get('location'),
    '/status/main/service/api%2Fgateway/?window=24h'
  );

  const image = await app.request('/status/main/metrics/opengraph.png');
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('etag'), '"og-etag"');
  assert.equal(image.headers.get('x-kuma-mieru-og'), 'rendered');
  assert.match(image.headers.get('cache-control') ?? '', /stale-while-revalidate=86400/u);
  assert.deepEqual(calls[0], {
    pageId: 'public',
    view: 'metrics',
    status: 'unknown',
    stale: true,
  });

  const unchanged = await app.request('/status/main/metrics/opengraph.png', {
    headers: { 'If-None-Match': 'W/"og-etag"' },
  });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');

  const missing = await app.request('/api/v1/public/pages/missing/opengraph.png');
  assert.equal(missing.status, 404);
  const body = (await missing.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'PAGE_NOT_FOUND');
});

test('keeps public email subscription disabled until a verified runtime is active', async () => {
  const app = createApp({
    snapshot,
    schemaVersion: 9,
    buildVersion: '2.0.0-test',
    authSecret: 'subscription-capability-secret-with-sufficient-entropy',
    isEmailDeliveryEnabled: () => false,
  });
  const meta = await app.request('/api/v1/meta');
  const metaBody = (await meta.json()) as {
    capabilities: { emailSubscriptions: boolean };
  };
  assert.equal(metaBody.capabilities.emailSubscriptions, false);
  const nonce = await app.request('/api/v1/public/pages/main/subscriptions/email/nonce');
  assert.equal(nonce.status, 503);
  const nonceBody = (await nonce.json()) as { error: { code: string } };
  assert.equal(nonceBody.error.code, 'SUBSCRIPTIONS_NOT_READY');
});

test('serves mirrored source history only through its read-only origin boundary', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-mirrored-api-'));
  const databasePath = resolve(directory, 'mirrored-api.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const sourceSnapshot = {
      sourceId: 'primary',
      pageId: 'main',
      title: 'Example Status',
      description: '',
      status: 'major_outage' as const,
      fetchedAt: '2026-07-25T03:00:00.000Z',
      sourceUpdatedAt: '2026-07-25T02:59:00.000Z',
      extensions: {},
      capabilities: {
        currentStatus: true,
        heartbeatSeries: false,
        latencySeries: false,
        uptimeWindows: [],
        incidents: 'current' as const,
        maintenance: false,
        groups: false,
        tags: false,
        nativeMetrics: false,
        historicalDays: null,
      },
      groups: [],
      services: [],
      incidents: [
        {
          id: 'primary:incident:upstream-1',
          sourceEventId: 'upstream-1',
          kind: 'incident' as const,
          title: 'Upstream incident',
          content: 'Provider is investigating',
          severity: 'warning' as const,
          startedAt: '2026-07-25T02:50:00.000Z',
          updatedAt: '2026-07-25T02:59:00.000Z',
          rawStatus: 'investigating',
        },
      ],
    };
    reconcileMirroredEvents(database, sourceSnapshot, {
      sourceUrl: 'https://status.example.com/main?private=value',
    });
    reconcileMirroredEvents(
      database,
      { ...sourceSnapshot, sourceId: 'unmapped' },
      {
        sourceUrl: 'https://unmapped.example.com',
      }
    );
    const app = createApp({
      snapshot,
      schemaVersion: 10,
      buildVersion: '2.0.0-test',
      database,
    });

    const list = await app.request('/api/v1/public/pages/main/mirrored-events');
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as {
      data: Array<{
        id: string;
        origin: string;
        notificationEligible: boolean;
        source: { id: string; url: string | null };
      }>;
    };
    assert.equal(listBody.data.length, 1);
    assert.equal(listBody.data[0]?.source.id, 'primary');
    assert.equal(listBody.data[0]?.source.url, null);
    assert.equal(listBody.data[0]?.origin, 'mirrored');
    assert.equal(listBody.data[0]?.notificationEligible, false);

    const detail = await app.request(
      `/api/v1/public/pages/main/mirrored-events/${listBody.data[0]?.id}`
    );
    assert.equal(detail.status, 200);
    const detailBody = (await detail.json()) as {
      data: { entries: Array<{ observationKind: string }> };
    };
    assert.deepEqual(
      detailBody.data.entries.map(entry => entry.observationKind),
      ['initial']
    );
    const native = await app.request('/api/v1/public/pages/main/incidents');
    assert.deepEqual(await native.json(), { data: [] });
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('serves generic native metrics and methodology only from local extension caches', async () => {
  const metricExtension = {
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
  };
  const app = createApp({
    snapshot,
    schemaVersion: 9,
    buildVersion: '2.0.0-test',
    loadPageMetricWindows: () => [
      {
        sourceId: 'llm',
        pageId: 'default',
        window: '5m',
        fetchedAt: '2026-07-25T00:00:00Z',
        staleAfter: '2026-07-25T00:15:00Z',
        stale: false,
        extension: metricExtension,
      },
      {
        sourceId: 'llm',
        pageId: 'default',
        window: '1h',
        fetchedAt: '2026-07-25T00:00:00Z',
        staleAfter: '2026-07-25T00:45:00Z',
        stale: true,
        extension: {
          ...metricExtension,
          series: metricExtension.series.map(series => ({ ...series, window: '1h' })),
        },
      },
    ],
    loadPageMethodologies: () => [
      {
        sourceId: 'llm',
        pageId: 'default',
        fetchedAt: '2026-07-25T00:00:00Z',
        staleAfter: '2026-07-25T03:00:00Z',
        stale: false,
        snapshot: {
          methodologyVersion: '1.0',
          generatedAt: '2026-07-25T00:00:00Z',
          product: { name: 'LLM-Mieru', measurementKind: 'third_party_synthetic' },
          sourceKinds: ['synthetic_probe'],
          statusSemantics: { unknownIsHealthy: false },
          freshnessPolicy: { missingEvidence: 'unknown' },
          protocols: [{ id: 'perf_10', version: '1.0' }],
          metrics: [{ id: 'latency', unit: 'milliseconds' }],
          coverage: [],
          limitations: ['synthetic_measurement_only'],
          evidenceLinks: ['docs/contracts/llm-measurement-protocol.md'],
        },
      },
    ],
  });

  const catalog = await app.request('/api/v1/public/pages/main/metrics/catalog');
  assert.equal(catalog.status, 200);
  const catalogBody = (await catalog.json()) as {
    data: Array<{
      sourceId: string;
      metrics: Array<{ id: string }>;
      windows: Array<{ window: string; stale: boolean }>;
    }>;
  };
  assert.equal(catalogBody.data[0]?.sourceId, 'llm');
  assert.equal(catalogBody.data[0]?.metrics[0]?.id, 'latency');
  assert.deepEqual(catalogBody.data[0]?.windows, [
    {
      window: '5m',
      fetchedAt: '2026-07-25T00:00:00Z',
      staleAfter: '2026-07-25T00:15:00Z',
      stale: false,
    },
    {
      window: '1h',
      fetchedAt: '2026-07-25T00:00:00Z',
      staleAfter: '2026-07-25T00:45:00Z',
      stale: true,
    },
  ]);

  const query = await app.request(
    '/api/v1/public/pages/main/metrics/query?source=llm&metric=latency&window=5m'
  );
  assert.equal(query.status, 200);
  const queryBody = (await query.json()) as {
    data: Array<{ points: Array<{ dimensions: Record<string, string> }> }>;
  };
  assert.equal(queryBody.data[0]?.points[0]?.dimensions.region, 'ap-northeast-tyo');

  const hourly = await app.request(
    '/api/v1/public/pages/main/metrics/query?source=llm&metric=latency&window=1h'
  );
  assert.equal(hourly.status, 200);
  const hourlyBody = (await hourly.json()) as {
    data: Array<{ window: string; stale: boolean }>;
  };
  assert.equal(hourlyBody.data[0]?.window, '1h');
  assert.equal(hourlyBody.data[0]?.stale, true);

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

  const methodology = await app.request('/api/v1/public/pages/main/methodology');
  assert.equal(methodology.status, 200);
  const methodologyBody = (await methodology.json()) as {
    data: Array<{
      sourceId: string;
      stale: boolean;
      snapshot: { methodologyVersion: string; product: { name: string } };
    }>;
  };
  assert.equal(methodologyBody.data[0]?.sourceId, 'llm');
  assert.equal(methodologyBody.data[0]?.stale, false);
  assert.equal(methodologyBody.data[0]?.snapshot.methodologyVersion, '1.0');
  assert.equal(methodologyBody.data[0]?.snapshot.product.name, 'LLM-Mieru');
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
          sourceEventId: 'incident-1',
          kind: 'incident',
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

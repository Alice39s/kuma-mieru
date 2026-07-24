import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceJsonRequester } from '../types.js';
import { fetchLlmMieruMetrics, fetchLlmMieruSnapshot } from './adapter.js';

const meta = {
  apiVersion: '1.0',
  schemaVersion: '1.0',
  instanceId: 'instance-fixture',
  generatedAt: '2026-07-25T00:00:00Z',
  protocolVersions: ['1.0'],
  features: [
    'coverage',
    'metric-catalog',
    'metric-query',
    'status-snapshot',
    'service-catalog',
    'automatic-incidents',
    'methodology',
  ],
  futureField: 'ignored within the same major',
};

const service = {
  id: 'openai-global/gpt-fixture',
  providerRoute: 'openai-global',
  requestedModel: 'gpt-fixture',
  status: 'degraded',
  protocolVersion: '1.0',
  observedAt: '2026-07-24T23:59:00Z',
  regions: [
    {
      observedRegion: 'ap-northeast-tyo',
      macroRegion: 'east-asia',
      status: 'operational',
      coverageState: 'active',
      freshnessState: 'fresh',
      sampleCount: 10,
      consumerSuccessCount: 10,
    },
    {
      observedRegion: 'us-east-iad',
      macroRegion: 'north-america',
      status: 'degraded',
      coverageState: 'stale',
      freshnessState: 'stale',
      sampleCount: 10,
      consumerSuccessCount: 9,
    },
  ],
};

const services = { data: [service] };
const status = {
  generatedAt: '2026-07-25T00:00:00Z',
  coverageGeneratedAt: '2026-07-25T00:00:00Z',
  data: [{ ...service, ruleVersion: 'availability-v1' }],
};
const incidents = {
  data: [
    {
      id: 'automatic-incident-1',
      providerRoute: 'openai-global',
      requestedModel: 'gpt-fixture',
      state: 'open',
      severity: 'degraded',
      ruleVersion: 'availability-v1',
      openedAt: '2026-07-24T23:30:00Z',
      updatedAt: '2026-07-25T00:00:00Z',
      resolvedAt: null,
      latestEvidence: { degradedRegions: 1, affectedRegions: ['us-east-iad'] },
    },
  ],
};
const metricCatalog = {
  data: [
    {
      id: 'ttft_visible_ms',
      unit: 'milliseconds',
      minimumSamples: { p50: 10, p95: 30 },
    },
    {
      id: 'tool_call_error_rate',
      unit: 'ratio',
      minimumSamples: 1,
      requiredScenario: 'tool_min',
    },
  ],
};

const metricQuery = (metric: string) => ({
  generatedAt: '2026-07-25T00:00:00Z',
  metric,
  data: [
    {
      window: { start: '2026-07-24T23:55:00Z', end: '2026-07-25T00:00:00Z' },
      dimensions: {
        providerRoute: 'openai-global',
        requestedModel: 'gpt-fixture',
        scenario: metric === 'tool_call_error_rate' ? 'tool_min' : 'perf_10',
        observedRegion: 'ap-northeast-tyo',
      },
      protocolVersion: '1.0',
      sampleCount: 10,
      eligibleCount: 10,
      value: metric === 'tool_call_error_rate' ? { ratio: 0 } : { p50: 420 },
      freshness: { state: 'fresh', observedAt: '2026-07-24T23:59:00Z' },
      coverageState: 'active',
      limitations: metric === 'ttft_visible_ms' ? ['p95_insufficient_samples'] : [],
    },
  ],
});

const fixtureRequester = (
  requested: Array<{ path: string; authorization: string | undefined }>
): SourceJsonRequester => ({
  request: async (url, _resourceKey, schema, options) => {
    requested.push({
      path: `${url.pathname}${url.search}`,
      authorization: options?.headers?.Authorization,
    });
    if (url.pathname.endsWith('/meta')) return schema.parse(meta);
    if (url.pathname.endsWith('/services')) return schema.parse(services);
    if (url.pathname.endsWith('/status/snapshot')) return schema.parse(status);
    if (url.pathname.endsWith('/incidents')) return schema.parse(incidents);
    if (url.pathname.endsWith('/metrics/catalog')) return schema.parse(metricCatalog);
    if (url.pathname.endsWith('/metrics/query')) {
      return schema.parse(metricQuery(url.searchParams.get('metric') ?? ''));
    }
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  },
});

test('negotiates the frozen v1 producer shape and fails stale regions closed', async () => {
  const requested: Array<{ path: string; authorization: string | undefined }> = [];
  const snapshot = await fetchLlmMieruSnapshot(
    {
      sourceId: 'llm',
      baseUrl: 'https://metrics.example.com',
      pageId: 'default',
      token: 'read-status-token',
    },
    fixtureRequester(requested)
  );

  assert.deepEqual(requested.map(item => item.path).sort(), [
    '/api/v1/incidents',
    '/api/v1/meta',
    '/api/v1/services',
    '/api/v1/status/snapshot',
  ]);
  assert.equal(
    requested.every(item => item.authorization === 'Bearer read-status-token'),
    true
  );
  assert.equal(snapshot.groups.length, 2);
  assert.equal(snapshot.services[0]?.status, 'operational');
  assert.equal(snapshot.services[1]?.status, 'unknown');
  assert.equal(snapshot.status, 'unknown');
  assert.deepEqual(
    snapshot.services[0]?.tags.map(tag => [tag.name, tag.value]),
    [
      ['provider_route', 'openai-global'],
      ['model', 'gpt-fixture'],
      ['observed_region', 'ap-northeast-tyo'],
      ['macro_region', 'east-asia'],
      ['protocol_version', '1.0'],
    ]
  );
  assert.equal(snapshot.capabilities.nativeMetrics, true);
  assert.equal(snapshot.capabilities.incidents, 'history');
  assert.equal(snapshot.incidents[0]?.severity, 'warning');
  assert.equal(snapshot.incidents[0]?.rawStatus, 'open');
});

test('preserves generic metric dimensions and evidence without LLM fields in the core schema', async () => {
  const requested: Array<{ path: string; authorization: string | undefined }> = [];
  const extension = await fetchLlmMieruMetrics(
    {
      sourceId: 'llm',
      baseUrl: 'https://metrics.example.com',
      token: 'read-metrics-token',
      features: meta.features,
    },
    fixtureRequester(requested)
  );

  assert.equal(extension?.catalog.length, 2);
  assert.equal(extension?.series.length, 2);
  assert.equal(extension?.series[0]?.points[0]?.dimensions.observedRegion, 'ap-northeast-tyo');
  assert.equal(extension?.series[0]?.points[0]?.coverageState, 'active');
  assert.deepEqual(extension?.series[0]?.points[0]?.limitations, ['p95_insufficient_samples']);
  assert.equal(
    requested.every(item => item.authorization === 'Bearer read-metrics-token'),
    true
  );
  assert.deepEqual(requested.map(item => item.path).sort(), [
    '/api/v1/metrics/catalog',
    '/api/v1/metrics/query?metric=tool_call_error_rate&window=5m',
    '/api/v1/metrics/query?metric=ttft_visible_ms&window=5m',
  ]);
});

test('does not request optional endpoints that the producer did not advertise', async () => {
  const requested: string[] = [];
  const requester: SourceJsonRequester = {
    request: async (url, _resourceKey, schema) => {
      requested.push(url.pathname);
      if (url.pathname.endsWith('/meta')) return schema.parse({ ...meta, features: [] });
      if (url.pathname.endsWith('/services')) return schema.parse(services);
      if (url.pathname.endsWith('/status/snapshot')) return schema.parse(status);
      throw new Error(`Unexpected optional request: ${url.pathname}`);
    },
  };
  const snapshot = await fetchLlmMieruSnapshot(
    { sourceId: 'llm', baseUrl: 'https://metrics.example.com', pageId: 'default' },
    requester
  );
  assert.equal(requested.includes('/api/v1/incidents'), false);
  assert.equal(snapshot.capabilities.incidents, 'none');
  assert.equal(snapshot.capabilities.nativeMetrics, false);
  assert.equal(
    await fetchLlmMieruMetrics(
      {
        sourceId: 'llm',
        baseUrl: 'https://metrics.example.com',
        features: [],
      },
      requester
    ),
    null
  );
});

test('rejects an unsupported producer major version before reading data endpoints', async () => {
  const requester: SourceJsonRequester = {
    request: async (_url, _resourceKey, schema) => schema.parse({ ...meta, apiVersion: '2.0' }),
  };
  await assert.rejects(
    fetchLlmMieruSnapshot(
      { sourceId: 'llm', baseUrl: 'https://metrics.example.com', pageId: 'default' },
      requester
    ),
    error => {
      assert.equal((error as { code: string }).code, 'unsupported_version');
      return true;
    }
  );
});

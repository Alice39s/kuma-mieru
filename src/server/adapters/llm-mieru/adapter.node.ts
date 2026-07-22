import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceJsonRequester } from '../types.js';
import { fetchLlmMieruSnapshot } from './adapter.js';

const meta = {
  apiVersion: '1.0',
  schemaVersion: '1.0',
  instanceId: 'instance-fixture',
  generatedAt: '2026-07-23T00:00:00Z',
  protocolVersions: ['1.0'],
  features: ['coverage', 'metric-catalog', 'metric-query', 'incidents'],
  futureField: 'ignored within the same major',
};

const services = {
  data: [
    {
      id: 'route-eastasia',
      name: 'GPT route · East Asia',
      dimensions: {
        provider_route: 'openai-primary',
        model: 'gpt-fixture',
        scenario: 'one-shot-10',
        observed_region: 'tyo',
        macro_region: 'eastasia',
      },
    },
    {
      id: 'route-us-east',
      name: 'GPT route · US East',
      dimensions: {
        provider_route: 'openai-primary',
        model: 'gpt-fixture',
        scenario: 'one-shot-10',
        observed_region: 'iad',
        macro_region: 'us-east',
      },
    },
  ],
};

const status = {
  generatedAt: '2026-07-23T00:01:00Z',
  coverageGeneratedAt: '2026-07-23T00:00:30Z',
  data: [
    {
      serviceId: 'route-eastasia',
      status: 'operational',
      rawStatus: 'healthy',
      observedAt: '2026-07-23T00:00:50Z',
      freshness: 'fresh',
      protocolVersion: '1.0',
    },
    {
      serviceId: 'route-us-east',
      status: 'degraded',
      rawStatus: 'high_ttft',
      observedAt: '2026-07-22T23:00:00Z',
      freshness: 'stale',
      protocolVersion: '1.0',
    },
  ],
};

const incidents = {
  data: [
    {
      id: 'automatic-incident-1',
      title: 'Elevated TTFT in US East',
      summary: 'Synthetic probes exceeded the degraded threshold.',
      status: 'monitoring',
      severity: 'major',
      startedAt: '2026-07-22T23:30:00Z',
      updatedAt: '2026-07-23T00:00:00Z',
    },
  ],
};

const fixtureRequester = (
  requested: Array<{ path: string; authorization: string | undefined }>
): SourceJsonRequester => ({
  request: async (url, _resourceKey, schema, options) => {
    requested.push({ path: url.pathname, authorization: options?.headers?.Authorization });
    if (url.pathname.endsWith('/meta')) return schema.parse(meta);
    if (url.pathname.endsWith('/services')) return schema.parse(services);
    if (url.pathname.endsWith('/status/snapshot')) return schema.parse(status);
    if (url.pathname.endsWith('/incidents')) return schema.parse(incidents);
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  },
});

test('negotiates capabilities and preserves LLM dimensions outside the Kuma Core schema', async () => {
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
      ['provider_route', 'openai-primary'],
      ['model', 'gpt-fixture'],
      ['scenario', 'one-shot-10'],
      ['observed_region', 'tyo'],
      ['protocol_version', '1.0'],
    ]
  );
  assert.deepEqual(snapshot.extensions['llm-mieru'], {
    apiVersion: '1.0',
    schemaVersion: '1.0',
    protocolVersions: ['1.0'],
    upstreamFeatures: ['coverage', 'metric-catalog', 'metric-query', 'incidents'],
    coverageGeneratedAt: '2026-07-23T00:00:30Z',
  });
  assert.equal(snapshot.capabilities.nativeMetrics, false);
  assert.equal(snapshot.capabilities.incidents, 'history');
  assert.equal(snapshot.incidents[0]?.severity, 'danger');
});

test('does not request optional endpoints that the producer did not advertise', async () => {
  const requested: string[] = [];
  const requester: SourceJsonRequester = {
    request: async (url, _resourceKey, schema) => {
      requested.push(url.pathname);
      if (url.pathname.endsWith('/meta')) {
        return schema.parse({ ...meta, features: [] });
      }
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

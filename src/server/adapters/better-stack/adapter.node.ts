import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceJsonRequester } from '../types.js';
import { fetchBetterStackSnapshot } from './adapter.js';
import { betterStackStatusPageSchema } from './schemas.js';

const fixture = {
  data: {
    id: '133002',
    type: 'status_page',
    attributes: {
      company_name: 'Better Stack',
      aggregate_state: 'degraded',
      updated_at: '2026-07-22T18:16:02.920Z',
    },
  },
  included: [
    {
      id: 'section-1',
      type: 'status_page_section',
      attributes: { name: 'Core services', position: 0 },
    },
    {
      id: 'resource-1',
      type: 'status_page_resource',
      attributes: {
        status_page_section_id: 'section-1',
        public_name: 'API',
        explanation: '',
        position: 0,
        availability: 0.9998,
        status: 'degraded',
        status_history: [
          {
            day: '2026-07-22',
            status: 'degraded',
            downtime_duration: 0,
            maintenance_duration: 0,
          },
        ],
      },
    },
    {
      id: 'update-1',
      type: 'status_update',
      attributes: {
        message: 'We are investigating elevated latency.',
        published_at: '2026-07-22T18:12:00.000Z',
        affected_resources: [{ status_page_resource_id: 'resource-1', status: 'degraded' }],
      },
    },
    {
      id: 'report-1',
      type: 'status_report',
      attributes: {
        title: 'API latency',
        starts_at: '2026-07-22T18:10:00.000Z',
        ends_at: null,
        aggregate_state: 'degraded',
        affected_resources: [{ status_page_resource_id: 'resource-1', status: 'degraded' }],
      },
      relationships: {
        status_updates: { data: [{ id: 'update-1', type: 'status_update' }] },
      },
    },
    {
      id: 'future-1',
      type: 'future_resource_type',
      attributes: { status: 'new-state' },
    },
  ],
};

test('normalizes the Better Stack public index without failing on future included types', async () => {
  const requester: SourceJsonRequester = {
    request: async (_url, _resourceKey, schema) => schema.parse(fixture),
  };
  const snapshot = await fetchBetterStackSnapshot(
    { sourceId: 'better', baseUrl: 'https://status.betterstack.com', pageId: 'index' },
    requester
  );
  assert.equal(snapshot.title, 'Better Stack');
  assert.equal(snapshot.status, 'degraded');
  assert.equal(snapshot.capabilities.historicalDays, 90);
  assert.equal(snapshot.groups[0]?.serviceIds[0], 'better:service:resource-1');
  assert.equal(snapshot.services[0]?.uptime24h, null);
  assert.equal(snapshot.incidents[0]?.content, 'We are investigating elevated latency.');
  assert.equal(snapshot.incidents[0]?.severity, 'warning');
  assert.equal(betterStackStatusPageSchema.parse(fixture).included.length, 5);
});

test('maps new Better Stack service states to unknown instead of operational', async () => {
  const unknownFixture = structuredClone(fixture);
  unknownFixture.data.attributes.aggregate_state = 'future_state';
  unknownFixture.included[1]!.attributes.status = 'future_state';
  const requester: SourceJsonRequester = {
    request: async (_url, _resourceKey, schema) => schema.parse(unknownFixture),
  };
  const snapshot = await fetchBetterStackSnapshot(
    { sourceId: 'better', baseUrl: 'https://status.example.com', pageId: 'index' },
    requester
  );
  assert.equal(snapshot.status, 'unknown');
  assert.equal(snapshot.services[0]?.status, 'unknown');
});

test('rejects malformed resources for known Better Stack included types', async () => {
  const malformedFixture = structuredClone(fixture);
  delete malformedFixture.included[1]!.attributes.public_name;
  const requester: SourceJsonRequester = {
    request: async (_url, _resourceKey, schema) => schema.parse(malformedFixture),
  };
  await assert.rejects(
    fetchBetterStackSnapshot(
      { sourceId: 'better', baseUrl: 'https://status.example.com', pageId: 'index' },
      requester
    )
  );
});

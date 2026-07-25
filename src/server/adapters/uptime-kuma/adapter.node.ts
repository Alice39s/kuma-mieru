import assert from 'node:assert/strict';
import test from 'node:test';
import type { z } from 'zod';
import { fetchUptimeKumaSnapshot, type SourceJsonRequester } from './adapter.js';

const pageV1 = {
  config: { title: 'Example Status', description: 'Public status', icon: '/upload/icon.png' },
  publicGroupList: [
    {
      id: 10,
      name: 'Core',
      weight: 1,
      monitorList: [
        { id: 1, name: 'API', tags: [{ name: 'region', value: 'us-east', color: '#10b981' }] },
        { id: 2, name: 'Dashboard' },
      ],
    },
  ],
  incident: {
    id: 7,
    style: 'warning',
    title: 'Elevated latency',
    content: 'Investigating',
    createdDate: '2026-07-23 10:00:00',
    lastUpdatedDate: null,
  },
  maintenanceList: [],
};

const heartbeat = {
  heartbeatList: {
    '1': [{ status: 1, time: '2026-07-23 10:00:00', ping: 42 }],
    '2': [{ status: 0, time: '2026-07-23 10:00:01', ping: null }],
  },
  uptimeList: { '1_24': 0.999, '2_24': 0.97 },
};

const requesterFor = (page: unknown): SourceJsonRequester => ({
  request: async <T>(_url: URL, resourceKey: string, schema: z.ZodType<T>) =>
    schema.parse(resourceKey.startsWith('page:') ? page : heartbeat),
});

test('normalizes the Uptime Kuma v1 single incident and mixed monitor state', async () => {
  const snapshot = await fetchUptimeKumaSnapshot(
    { sourceId: 'primary', baseUrl: 'https://status.example.com', pageId: 'main' },
    requesterFor(pageV1)
  );
  assert.equal(snapshot.status, 'partial_outage');
  assert.equal(snapshot.services[0]?.status, 'operational');
  assert.equal(snapshot.services[0]?.latencyMs, 42);
  assert.equal(snapshot.services[1]?.status, 'major_outage');
  assert.equal(snapshot.incidents[0]?.id, 'primary:incident:7');
  assert.equal(snapshot.capabilities.tags, true);
  assert.deepEqual(snapshot.extensions['uptime-kuma'], { icon: '/upload/icon.png' });
});

test('normalizes the Uptime Kuma v2 incident array without relying on the v1 field', async () => {
  const snapshot = await fetchUptimeKumaSnapshot(
    { sourceId: 'primary', baseUrl: 'https://status.example.com', pageId: 'main' },
    requesterFor({
      ...pageV1,
      incident: undefined,
      incidents: [
        { id: 8, style: 'danger', title: 'API outage', content: '', createdDate: null },
        { id: 9, style: 'info', title: 'Recovery', content: '', createdDate: null },
      ],
    })
  );
  assert.deepEqual(
    snapshot.incidents.map(incident => incident.id),
    ['primary:incident:8', 'primary:incident:9']
  );
  assert.equal(snapshot.capabilities.incidents, 'current');
});

test('rejects an upstream payload that violates the public wire schema', async () => {
  await assert.rejects(
    fetchUptimeKumaSnapshot(
      { sourceId: 'primary', baseUrl: 'https://status.example.com', pageId: 'main' },
      requesterFor({ config: {}, publicGroupList: 'not-an-array' })
    ),
    error =>
      typeof error === 'object' && error !== null && 'name' in error && error.name === 'ZodError'
  );
});

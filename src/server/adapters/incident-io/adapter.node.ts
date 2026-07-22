import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceJsonRequester } from '../types.js';
import { fetchIncidentIoSnapshot } from './adapter.js';

const fixture = {
  page_title: 'Example Status',
  page_url: 'https://status.example.com/',
  ongoing_incidents: [
    {
      id: 'incident-1',
      name: 'API latency',
      status: 'identified',
      url: 'https://status.example.com/incidents/incident-1',
      last_update_at: '2026-07-23T05:10:00.000Z',
      last_update_message: 'We identified a saturated dependency.',
      current_worst_impact: 'partial_outage',
      affected_components: [
        {
          id: 'api',
          name: 'API',
          group_name: 'Core',
          current_status: 'partial_outage',
        },
      ],
    },
  ],
  in_progress_maintenances: [
    {
      id: 'maintenance-1',
      name: 'Database maintenance',
      status: 'maintenance_in_progress',
      url: 'https://status.example.com/maintenances/maintenance-1',
      last_update_at: '2026-07-23T05:15:00.000Z',
      last_update_message: 'Maintenance is in progress.',
      affected_components: [
        { id: 'database', name: 'Database', group_name: 'Core', current_status: 'operational' },
      ],
      started_at: '2026-07-23T05:00:00.000Z',
      scheduled_end_at: '2026-07-23T06:00:00.000Z',
    },
  ],
  scheduled_maintenances: [
    {
      id: 'maintenance-2',
      name: 'Network maintenance',
      status: 'maintenance_scheduled',
      url: 'https://status.example.com/maintenances/maintenance-2',
      last_update_at: '2026-07-23T04:00:00.000Z',
      last_update_message: 'Maintenance is scheduled.',
      affected_components: [],
      starts_at: '2026-07-24T05:00:00.000Z',
      ends_at: '2026-07-24T06:00:00.000Z',
    },
  ],
};

test('normalizes the incident.io public Widget summary without inventing history', async () => {
  const requester: SourceJsonRequester = {
    request: async (url, _resourceKey, schema) => {
      assert.equal(url.toString(), 'https://status.example.com/api/v1/summary');
      return schema.parse(fixture);
    },
  };
  const snapshot = await fetchIncidentIoSnapshot(
    { sourceId: 'incidentio', baseUrl: 'https://status.example.com', pageId: 'summary' },
    requester
  );
  assert.equal(snapshot.status, 'partial_outage');
  assert.equal(
    snapshot.services.find(service => service.name === 'Database')?.status,
    'maintenance'
  );
  assert.equal(snapshot.groups[0]?.name, 'Core');
  assert.equal(snapshot.incidents.length, 3);
  assert.equal(snapshot.capabilities.incidents, 'current');
  assert.equal(snapshot.capabilities.historicalDays, null);
});

test('maps future incident.io impact values to unknown instead of operational', async () => {
  const futureFixture = structuredClone(fixture);
  futureFixture.ongoing_incidents[0]!.current_worst_impact = 'future_impact';
  futureFixture.in_progress_maintenances = [];
  const requester: SourceJsonRequester = {
    request: async (_url, _resourceKey, schema) => schema.parse(futureFixture),
  };
  const snapshot = await fetchIncidentIoSnapshot(
    { sourceId: 'incidentio', baseUrl: 'https://status.example.com', pageId: 'summary' },
    requester
  );
  assert.equal(snapshot.status, 'unknown');
});

test('reports an unavailable Widget endpoint as an unsupported page type', async () => {
  const requester: SourceJsonRequester = {
    request: async () => {
      throw Object.assign(new Error('Source returned HTTP 404'), { code: 'http_404' });
    },
  };
  await assert.rejects(
    fetchIncidentIoSnapshot(
      { sourceId: 'incidentio', baseUrl: 'https://internal.example.com', pageId: 'summary' },
      requester
    ),
    error => {
      assert.equal((error as { code: string }).code, 'unsupported_page_type');
      return true;
    }
  );
});

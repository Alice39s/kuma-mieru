import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceJsonRequester } from '../types.js';
import { fetchUptimeRobotSnapshot } from './adapter.js';

const monitor = (input: {
  id: number;
  name: string;
  status: string;
  groupId?: number | null;
  uptime?: number[];
}) => ({
  id: input.id,
  friendlyName: input.name,
  status: input.status,
  url: `https://service-${input.id}.example.com`,
  groupId: input.groupId ?? null,
  tags: [{ id: 1, name: 'production', color: '#2255aa' }],
  lastDayUptimes: {
    bucketSize: 3600,
    histogram: (input.uptime ?? [100]).map((uptime, index) => ({
      timestamp: 1_753_200_000 + index * 3600,
      uptime,
      changes: 0,
    })),
  },
});

test('normalizes UptimeRobot v3 monitors with authenticated cursor pagination', async () => {
  const requested: Array<{ url: string; authorization: string | undefined }> = [];
  const requester: SourceJsonRequester = {
    request: async (url, _resourceKey, schema, options) => {
      requested.push({ url: url.toString(), authorization: options?.headers?.Authorization });
      if (url.pathname.endsWith('/monitor-groups')) {
        return schema.parse({
          nextLink: null,
          data: [{ id: 7, name: 'Production', createdAt: '', updatedAt: '' }],
        });
      }
      if (url.searchParams.get('cursor') === '20') {
        return schema.parse({
          nextLink: null,
          data: [monitor({ id: 3, name: 'Unknown worker', status: 'FUTURE_STATE' })],
        });
      }
      return schema.parse({
        nextLink: 'https://api.uptimerobot.com/v3/monitors?cursor=20',
        data: [
          monitor({ id: 1, name: 'API', status: 'UP', groupId: 7, uptime: [100, 98] }),
          monitor({ id: 2, name: 'Web', status: 'DOWN', groupId: 7 }),
        ],
      });
    },
  };

  const snapshot = await fetchUptimeRobotSnapshot(
    {
      sourceId: 'robot',
      baseUrl: 'https://api.uptimerobot.com/v3',
      pageId: 'all',
      token: 'read-only-jwt',
    },
    requester
  );

  assert.equal(snapshot.services.length, 3);
  assert.equal(snapshot.status, 'major_outage');
  assert.equal(snapshot.services[0]?.uptime24h, 99);
  assert.equal(snapshot.services[1]?.status, 'major_outage');
  assert.equal(snapshot.services[2]?.status, 'unknown');
  assert.equal(snapshot.groups.find(group => group.name === 'Production')?.serviceIds.length, 2);
  assert.equal(
    requested.every(item => item.authorization === 'Bearer read-only-jwt'),
    true
  );
  assert.equal(
    requested.some(item => item.url.includes('limit=200')),
    true
  );
  assert.equal(
    requested.some(item => item.url.includes('cursor=20')),
    true
  );
});

test('rejects an UptimeRobot nextLink that leaves the configured API endpoint', async () => {
  const requester: SourceJsonRequester = {
    request: async (url, _resourceKey, schema) =>
      schema.parse(
        url.pathname.endsWith('/monitor-groups')
          ? { nextLink: null, data: [] }
          : { nextLink: 'https://attacker.example/monitors?cursor=20', data: [] }
      ),
  };
  await assert.rejects(
    fetchUptimeRobotSnapshot(
      {
        sourceId: 'robot',
        baseUrl: 'https://api.uptimerobot.com/v3',
        pageId: 'all',
        token: 'read-only-jwt',
      },
      requester
    ),
    error => {
      assert.equal((error as { code: string }).code, 'invalid_pagination_link');
      return true;
    }
  );
});

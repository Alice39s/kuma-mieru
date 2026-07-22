import assert from 'node:assert/strict';
import test from 'node:test';
import type { z } from 'zod';
import type { SourceJsonRequester } from './uptime-kuma/adapter.js';
import { createSourceTestService } from './source-test.js';

const requester: SourceJsonRequester = {
  request: async <T>(_url: URL, resourceKey: string, schema: z.ZodType<T>) =>
    schema.parse(
      resourceKey.startsWith('page:')
        ? {
            config: { title: 'Status', description: '' },
            publicGroupList: [{ id: 1, name: 'Core', monitorList: [{ id: 42, name: 'API' }] }],
            incidents: [],
            maintenanceList: [],
          }
        : {
            heartbeatList: {
              '42': [{ status: 1, time: '2026-07-23 00:00:00', ping: 21 }],
            },
            uptimeList: { '42_24': 0.999 },
          }
    ),
};

const source = {
  id: 'primary',
  kind: 'uptime-kuma' as const,
  baseUrl: 'https://status.example.com',
  pageIds: ['main'],
};

test('binds a short-lived source test token to the exact validated source', async () => {
  const service = createSourceTestService({
    secret: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH',
    requester,
  });
  const result = await service.test(source);
  assert.deepEqual(result.pages, [
    { pageId: 'main', title: 'Status', status: 'operational', serviceCount: 1 },
  ]);
  assert.equal(service.validate(source, result.token), true);
  assert.equal(
    service.validate({ ...source, baseUrl: 'https://changed.example.com' }, result.token),
    false
  );
  assert.equal(service.validate(source, `${result.token}tampered`), false);
});

test('rejects a source test token after its validity window', async () => {
  const service = createSourceTestService({
    secret: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH',
    requester,
    lifetimeMs: -1,
  });
  const result = await service.test(source);
  assert.equal(service.validate(source, result.token), false);
});

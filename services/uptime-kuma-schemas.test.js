import { expect, test } from 'bun:test';
import { ZodError } from 'zod';
import { parseMonitorGroups, parseMonitoringPayload } from './uptime-kuma-schemas';

test('parseMonitoringPayload accepts and normalizes the Uptime Kuma monitor payload shape', () => {
  const parsed = parseMonitoringPayload({
    heartbeatList: {
      1: [{ status: 1, time: '2026-06-10 00:00:00', msg: '', ping: 42 }],
    },
    uptimeList: {
      '1_24': 0.99,
    },
  });

  expect(parsed.heartbeatList['1'][0].ping).toBe(42);
  expect(parsed.uptimeList['1_24']).toBe(0.99);
});

test('parseMonitoringPayload rejects non-record heartbeat and uptime fields', () => {
  expect(() =>
    parseMonitoringPayload({
      heartbeatList: [],
      uptimeList: {},
    })
  ).toThrow(ZodError);

  expect(() =>
    parseMonitoringPayload({
      heartbeatList: {},
      uptimeList: [],
    })
  ).toThrow(ZodError);
});

test('parseMonitorGroups validates group and monitor arrays at the service boundary', () => {
  const parsed = parseMonitorGroups([
    {
      id: 1,
      name: 'Core',
      weight: 0,
      monitorList: [{ id: 7, name: 'API', sendUrl: 0, type: 'http' }],
    },
  ]);

  expect(parsed[0].monitorList[0].name).toBe('API');
});

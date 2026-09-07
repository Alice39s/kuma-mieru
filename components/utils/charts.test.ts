import { expect, test } from 'bun:test';
import type { Heartbeat } from '@/types/monitor';
import { calculatePingMetrics, calculatePingStats } from './charts';

const heartbeat = (ping: number | null, status: Heartbeat['status'] = 1): Heartbeat => ({
  ping,
  status,
  time: '2026-09-08 00:00:00',
  msg: '',
});

test('statistics exclude offline and zero pings while preserving latest ping', () => {
  const samples = [
    heartbeat(10),
    heartbeat(20),
    heartbeat(30),
    heartbeat(40),
    heartbeat(0),
    heartbeat(100, 0),
  ];
  const original = structuredClone(samples);
  expect(calculatePingStats(samples)).toEqual({ min: 10, p25: 20, p50: 30, p75: 40, max: 40 });
  expect(calculatePingMetrics(samples)).toEqual({
    latestPing: 100,
    avgPing: 25,
    trimmedAvgPing: 25,
  });
  expect(samples).toEqual(original);
});

test('trimmed average removes both tails and new snapshots recompute results', () => {
  const samples = [1, 10, 10, 10, 10, 10, 10, 10, 10, 1000].map(ping => heartbeat(ping));
  expect(calculatePingMetrics(samples)).toEqual({
    latestPing: 1000,
    avgPing: 108,
    trimmedAvgPing: 10,
  });
  expect(calculatePingMetrics([heartbeat(50)])).toEqual({
    latestPing: 50,
    avgPing: 50,
    trimmedAvgPing: 50,
  });
});

test('empty or entirely unavailable histories have no statistics', () => {
  expect(calculatePingStats([])).toBeNull();
  expect(calculatePingMetrics([heartbeat(null), heartbeat(0), heartbeat(20, 3)])).toBeNull();
});

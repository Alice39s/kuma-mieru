import type { Heartbeat } from '@/types/monitor';
import { COLOR_SYSTEM, getStatusColorByStats } from './colors';

export const getStatusColor = (heartbeat: Heartbeat, pingStats: PingStats | null) => {
  const { status, ping } = heartbeat;
  if (status === 0) return COLOR_SYSTEM.error;
  if (status === 3) return COLOR_SYSTEM.maintenance;
  if (status === 2) return COLOR_SYSTEM.warning;
  if (!ping || !pingStats) return COLOR_SYSTEM.excellent;
  return getStatusColorByStats(ping, pingStats);
};

export interface PingStats {
  min: number;
  p25: number;
  p50: number;
  p75: number;
  max: number;
}

export interface PingMetrics {
  latestPing: number;
  avgPing: number;
  trimmedAvgPing: number;
}

interface HeartbeatSummary {
  stats: PingStats;
  metrics: PingMetrics;
}

// SWR snapshots are immutable; weak keys release statistics with their source data.
const summaries = new WeakMap<Heartbeat[], HeartbeatSummary | null>();

function summarizeHeartbeats(heartbeats: Heartbeat[]): HeartbeatSummary | null {
  if (summaries.has(heartbeats)) return summaries.get(heartbeats) ?? null;

  const sorted: number[] = [];
  let total = 0;
  for (const heartbeat of heartbeats) {
    if (heartbeat.status === 1 && heartbeat.ping) {
      sorted.push(heartbeat.ping);
      total += heartbeat.ping;
    }
  }
  if (sorted.length === 0) {
    summaries.set(heartbeats, null);
    return null;
  }

  sorted.sort((a, b) => a - b);
  const count = sorted.length;
  const trimStart = Math.floor(count * 0.1);
  const trimEnd = Math.ceil(count * 0.9);
  let trimmedTotal = 0;
  for (let index = trimStart; index < trimEnd; index++) trimmedTotal += sorted[index];

  const summary = {
    stats: {
      min: sorted[0],
      p25: sorted[Math.floor(count * 0.25)],
      p50: sorted[Math.floor(count * 0.5)],
      p75: sorted[Math.floor(count * 0.75)],
      max: sorted[count - 1],
    },
    metrics: {
      latestPing: heartbeats[heartbeats.length - 1]?.ping || 0,
      avgPing: Math.round(total / count),
      trimmedAvgPing: Math.round(trimmedTotal / (trimEnd - trimStart)),
    },
  };
  summaries.set(heartbeats, summary);
  return summary;
}

export const calculatePingStats = (heartbeats: Heartbeat[]): PingStats | null =>
  summarizeHeartbeats(heartbeats)?.stats ?? null;

export const calculatePingMetrics = (heartbeats: Heartbeat[]): PingMetrics | null =>
  summarizeHeartbeats(heartbeats)?.metrics ?? null;

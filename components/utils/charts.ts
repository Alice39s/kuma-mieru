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

export const calculatePingStats = (heartbeats: Heartbeat[]): PingStats | null => {
  const onlinePings = heartbeats
    .filter(hb => hb.status === 1 && hb.ping)
    .map(hb => hb.ping as number);

  if (onlinePings.length === 0) return null;

  const sorted = [...onlinePings].sort((a, b) => a - b);
  return {
    min: sorted[0],
    p25: sorted[Math.floor(sorted.length * 0.25)],
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p75: sorted[Math.floor(sorted.length * 0.75)],
    max: sorted[sorted.length - 1],
  };
};

export const calculatePingMetrics = (heartbeats: Heartbeat[]): PingMetrics | null => {
  const onlinePings = heartbeats
    .filter(hb => hb.status === 1 && hb.ping)
    .map(hb => hb.ping as number);

  if (onlinePings.length === 0) return null;

  // 最新延迟
  const latestPing = heartbeats[heartbeats.length - 1]?.ping || 0;

  // 平均延迟
  const avgPing = Math.round(onlinePings.reduce((acc, curr) => acc + curr, 0) / onlinePings.length);

  // 去除峰值后的平均延迟（去除最高和最低的 10%）
  const sorted = [...onlinePings].sort((a, b) => a - b);
  const trimStart = Math.floor(sorted.length * 0.1);
  const trimEnd = Math.ceil(sorted.length * 0.9);
  const trimmedPings = sorted.slice(trimStart, trimEnd);
  const trimmedAvgPing = Math.round(
    trimmedPings.reduce((acc, curr) => acc + curr, 0) / trimmedPings.length
  );

  return {
    latestPing,
    avgPing,
    trimmedAvgPing,
  };
};

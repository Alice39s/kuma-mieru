import type { Heartbeat } from '@/types/monitor';
import { MONITOR_STATUS_VISUAL, getMonitorStatusKey } from '@/utils/monitor-status';
import { AlertCircle, CheckCircle2, MinusCircle, Wrench } from 'lucide-react';

const STATUS_ICON_MAP = {
  up: CheckCircle2,
  pending: MinusCircle,
  down: AlertCircle,
  maintenance: Wrench,
  unknown: AlertCircle,
} as const;

export const getMonitorCardStatusMeta = (heartbeats: Heartbeat[]) => {
  const lastHeartbeat = heartbeats[heartbeats.length - 1];
  const currentStatus = getMonitorStatusKey(lastHeartbeat?.status);

  return {
    currentStatus,
    statusVisual: MONITOR_STATUS_VISUAL[currentStatus],
    StatusIcon: STATUS_ICON_MAP[currentStatus],
  };
};

export const getUptimeRingData = (uptime24h: number, ringFill: string) => [
  {
    value: uptime24h * 100,
    fill: ringFill,
  },
];

export const getMonitorDetailPath = (monitorId: number, pageId: string) =>
  `/monitor/${monitorId}?pageId=${encodeURIComponent(pageId)}`;

export const getTagChipStyle = (tagColor: string) => ({
  backgroundColor: `${tagColor}15`,
  color: tagColor,
});

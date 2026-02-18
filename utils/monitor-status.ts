import type { Heartbeat, HeartbeatData, MonitorGroup } from '@/types/monitor';

export type MonitorStatusKey = 'up' | 'down' | 'pending' | 'maintenance' | 'unknown';

interface StatusVisualConfig {
  chartColor: 'success' | 'warning' | 'danger' | 'primary' | 'default';
  ringFill: string;
  iconClassName: string;
  valueClassName: string;
}

export const MONITOR_STATUS_VISUAL: Record<MonitorStatusKey, StatusVisualConfig> = {
  up: {
    chartColor: 'success',
    ringFill: '#17c964',
    iconClassName: 'text-success',
    valueClassName: 'text-success-600 dark:text-success-500',
  },
  down: {
    chartColor: 'danger',
    ringFill: '#f31260',
    iconClassName: 'text-danger',
    valueClassName: 'text-danger-600 dark:text-danger-500',
  },
  pending: {
    chartColor: 'warning',
    ringFill: '#f5a524',
    iconClassName: 'text-warning',
    valueClassName: 'text-warning-600 dark:text-warning-500',
  },
  maintenance: {
    chartColor: 'primary',
    ringFill: '#338ef7',
    iconClassName: 'text-primary',
    valueClassName: 'text-primary-600 dark:text-primary-400',
  },
  unknown: {
    chartColor: 'default',
    ringFill: '#a1a1aa',
    iconClassName: 'text-default-500',
    valueClassName: 'text-default-500 dark:text-default-400',
  },
};

export interface MonitorStatusCounts {
  total: number;
  up: number;
  down: number;
  pending: number;
  maintenance: number;
  unknown: number;
  abnormal: number;
}

export const getLatestHeartbeat = (heartbeats: Heartbeat[] | undefined) =>
  heartbeats && heartbeats.length > 0 ? heartbeats[heartbeats.length - 1] : undefined;

export const getMonitorStatusKey = (status?: Heartbeat['status']): MonitorStatusKey => {
  if (status === 1) return 'up';
  if (status === 0) return 'down';
  if (status === 2) return 'pending';
  if (status === 3) return 'maintenance';
  return 'unknown';
};

export const isAbnormalMonitorStatus = (status: MonitorStatusKey) => status !== 'up';

export const calculateMonitorStatusCounts = (
  monitorGroups: MonitorGroup[],
  heartbeatList: HeartbeatData
): MonitorStatusCounts => {
  const monitorIds = new Set<number>();

  monitorGroups.forEach(group => {
    group.monitorList.forEach(monitor => {
      monitorIds.add(monitor.id);
    });
  });

  const counts: MonitorStatusCounts = {
    total: monitorIds.size,
    up: 0,
    down: 0,
    pending: 0,
    maintenance: 0,
    unknown: 0,
    abnormal: 0,
  };

  monitorIds.forEach(monitorId => {
    const currentStatus = getMonitorStatusKey(getLatestHeartbeat(heartbeatList[monitorId])?.status);
    counts[currentStatus] += 1;

    if (isAbnormalMonitorStatus(currentStatus)) {
      counts.abnormal += 1;
    }
  });

  return counts;
};

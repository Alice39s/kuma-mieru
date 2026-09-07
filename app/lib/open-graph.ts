import { getConfig } from '@/config/api';
import { getMonitoringDataResult } from '@/services/monitor.server';
import type { Heartbeat } from '@/types/monitor';

export interface OpenGraphMetric {
  label: string;
  value: string;
}

export interface OpenGraphData {
  title: string;
  description: string;
  pageTitle: string;
  pageId: string;
  status: string;
  color: string;
  metrics: OpenGraphMetric[];
  checks: Pick<Heartbeat, 'status' | 'ping'>[];
  isAvailable: boolean;
  isMonitor: boolean;
}

export async function getOpenGraphData(
  pageId?: string,
  monitorId?: number,
  isAbout = false
): Promise<OpenGraphData | null> {
  const config = getConfig(pageId);
  if (!config) return null;
  const base: OpenGraphData = {
    title: isAbout ? 'Kuma Mieru' : config.siteMeta.title,
    description: isAbout
      ? 'An open-source dashboard for Uptime Kuma.'
      : config.siteMeta.description,
    pageTitle: config.siteMeta.title,
    pageId: config.pageId,
    status: isAbout ? 'Open source' : 'Monitoring data unavailable',
    color: isAbout ? '#34d399' : '#a1a1aa',
    metrics: [],
    checks: [],
    isAvailable: isAbout,
    isMonitor: monitorId !== undefined,
  };
  if (isAbout) {
    base.metrics = [
      { label: 'PLATFORM', value: 'Uptime Kuma' },
      { label: 'LICENSE', value: 'MPL-2.0' },
      { label: 'STATUS PAGES', value: String(config.pageIds.length) },
    ];
    return base;
  }

  const result = await getMonitoringDataResult(config.pageId);
  if (!result.success) {
    if (monitorId !== undefined) base.title = `Monitor ${monitorId}`;
    return base;
  }
  const { monitorGroups, data } = result.data;
  if (monitorId !== undefined) {
    const monitor = monitorGroups
      .flatMap(group => group.monitorList)
      .find(item => item.id === monitorId);
    if (!monitor) return null;
    const history = data.heartbeatList[monitorId] ?? [];
    const last = history.at(-1);
    const status = last?.status;
    base.title = monitor.name;
    base.status =
      status === 1
        ? 'Operational'
        : status === 0
          ? 'Offline'
          : status === 3
            ? 'Maintenance'
            : 'Pending';
    base.color = status === 1 ? '#34d399' : status === 0 ? '#fb7185' : '#fbbf24';
    base.checks = history.slice(-60).map(({ status, ping }) => ({ status, ping }));
    const uptime = data.uptimeList[`${monitorId}_24`];
    base.metrics = [
      {
        label: 'UPTIME / 24H',
        value: uptime === undefined ? 'N/A' : `${(uptime * 100).toFixed(2)}%`,
      },
      {
        label: 'LATEST LATENCY',
        value: last?.ping == null ? 'N/A' : `${Math.round(last.ping)} ms`,
      },
      { label: 'MONITOR TYPE', value: monitor.type.toUpperCase() },
    ];
  } else {
    const monitors = monitorGroups.flatMap(group => group.monitorList);
    base.checks = monitors.map(monitor => {
      const heartbeat = data.heartbeatList[monitor.id]?.at(-1);
      return { status: heartbeat?.status ?? 2, ping: heartbeat?.ping ?? null };
    });
    const online = base.checks.filter(check => check.status === 1).length;
    const unavailable = monitors.length - online;
    base.status =
      monitors.length === 0
        ? 'No monitors'
        : unavailable
          ? 'Service degradation'
          : 'All systems operational';
    base.color = unavailable ? '#fbbf24' : '#34d399';
    base.metrics = [
      { label: 'MONITORS', value: String(monitors.length) },
      { label: 'OPERATIONAL', value: String(online) },
      { label: 'UNAVAILABLE', value: String(unavailable) },
    ];
    base.checks = base.checks.slice(0, 60);
  }
  base.isAvailable = true;
  return base;
}

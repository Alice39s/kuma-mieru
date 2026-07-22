import type { NormalizedSnapshot, NormalizedStatus } from '../types.js';
import type { UptimeKumaHeartbeat, UptimeKumaPage } from './schemas.js';

export interface NormalizeUptimeKumaInput {
  sourceId: string;
  pageId: string;
  page: UptimeKumaPage;
  heartbeat: UptimeKumaHeartbeat;
  fetchedAt?: Date;
}

const mapHeartbeatStatus = (status: number): NormalizedStatus => {
  if (status === 0) return 'major_outage';
  if (status === 1) return 'operational';
  if (status === 2) return 'pending';
  if (status === 3) return 'maintenance';
  return 'unknown';
};

const aggregateStatus = (statuses: NormalizedStatus[]): NormalizedStatus => {
  if (statuses.every(status => status === 'unknown')) return 'unknown';
  if (statuses.every(status => status === 'operational')) return 'operational';
  if (statuses.every(status => status === 'major_outage')) return 'major_outage';
  if (statuses.every(status => status === 'maintenance')) return 'maintenance';
  if (statuses.some(status => status === 'major_outage')) return 'partial_outage';
  if (statuses.some(status => status === 'unknown' || status === 'pending')) return 'degraded';
  if (statuses.some(status => status === 'maintenance')) return 'degraded';
  return 'unknown';
};

const normalizeTime = (value: string | null | undefined) => {
  if (!value) return null;
  const normalized =
    value.endsWith('Z') || /[+-][0-9]{2}:[0-9]{2}$/u.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
};

export const normalizeUptimeKumaSnapshot = ({
  sourceId,
  pageId,
  page,
  heartbeat,
  fetchedAt = new Date(),
}: NormalizeUptimeKumaInput): NormalizedSnapshot => {
  const services = page.publicGroupList.flatMap(group =>
    group.monitorList.map(monitor => {
      const upstreamId = String(monitor.id);
      const heartbeats = heartbeat.heartbeatList[upstreamId] ?? [];
      const latest = heartbeats.at(-1);
      return {
        id: `${sourceId}:monitor:${upstreamId}`,
        sourceId,
        upstreamId,
        name: monitor.name,
        groupId: `${sourceId}:group:${group.id}`,
        tags: monitor.tags.map(tag => ({ name: tag.name, value: tag.value, color: tag.color })),
        status: latest ? mapHeartbeatStatus(latest.status) : ('unknown' as const),
        rawStatus: latest?.status ?? 'missing',
        latencyMs: latest?.ping ?? null,
        observedAt: normalizeTime(latest?.time),
        uptime24h: heartbeat.uptimeList[`${upstreamId}_24`] ?? null,
      };
    })
  );

  const incidents = page.incidents ?? (page.incident ? [page.incident] : []);
  const sourceUpdatedAt =
    services
      .map(service => service.observedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

  return {
    sourceId,
    pageId,
    title: page.config.title,
    description: page.config.description,
    status: aggregateStatus(services.map(service => service.status)),
    fetchedAt: fetchedAt.toISOString(),
    sourceUpdatedAt,
    capabilities: {
      currentStatus: true,
      heartbeatSeries: true,
      latencySeries: true,
      uptimeWindows: ['24h'],
      incidents: 'current',
      maintenance: 'maintenanceList' in page,
      groups: true,
      tags: services.some(service => service.tags.length > 0),
      nativeMetrics: false,
      historicalDays: null,
    },
    groups: page.publicGroupList.map(group => ({
      id: `${sourceId}:group:${group.id}`,
      name: group.name,
      position: group.weight,
      serviceIds: group.monitorList.map(monitor => `${sourceId}:monitor:${monitor.id}`),
    })),
    services,
    incidents: incidents.map(incident => ({
      id: `${sourceId}:incident:${incident.id}`,
      title: incident.title,
      content: incident.content,
      severity:
        incident.style === 'info' || incident.style === 'warning' || incident.style === 'danger'
          ? incident.style
          : 'unknown',
      startedAt: normalizeTime(incident.createdDate),
      updatedAt: normalizeTime(incident.lastUpdatedDate),
      rawStatus: incident.style,
    })),
  };
};

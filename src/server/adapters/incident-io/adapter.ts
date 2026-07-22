import {
  normalizedSnapshotSchema,
  type NormalizedStatus,
  type SourceJsonRequester,
} from '../types.js';
import { incidentIoSummarySchema, type IncidentIoSummary } from './schemas.js';

const normalizeComponentStatus = (status: string | undefined): NormalizedStatus => {
  switch (status) {
    case 'operational':
      return 'operational';
    case 'degraded_performance':
      return 'degraded';
    case 'partial_outage':
      return 'partial_outage';
    case 'full_outage':
      return 'major_outage';
    default:
      return 'unknown';
  }
};

const normalizeImpact = (impact: string): NormalizedStatus => {
  switch (impact) {
    case 'degraded_performance':
      return 'degraded';
    case 'partial_outage':
      return 'partial_outage';
    case 'full_outage':
      return 'major_outage';
    default:
      return 'unknown';
  }
};

const statusPriority: Record<NormalizedStatus, number> = {
  major_outage: 9,
  partial_outage: 8,
  degraded: 7,
  unknown: 6,
  maintenance: 5,
  pending: 3,
  paused: 2,
  operational: 1,
};

const worstStatus = (statuses: NormalizedStatus[], empty: NormalizedStatus) =>
  statuses.reduce<NormalizedStatus>(
    (worst, status) => (statusPriority[status] > statusPriority[worst] ? status : worst),
    empty
  );

interface ComponentState {
  id: string;
  name: string;
  groupName: string;
  status: NormalizedStatus;
  rawStatus: string;
  observedAt: string;
}

export const normalizeIncidentIoSummary = (input: {
  sourceId: string;
  pageId: string;
  payload: IncidentIoSummary;
  fetchedAt?: string;
}) => {
  const components = new Map<string, ComponentState>();
  const mergeComponent = (
    component: IncidentIoSummary['ongoing_incidents'][number]['affected_components'][number],
    status: NormalizedStatus,
    rawStatus: string,
    observedAt: string
  ) => {
    const existing = components.get(component.id);
    const keepExisting =
      existing !== undefined && statusPriority[existing.status] > statusPriority[status];
    components.set(component.id, {
      id: component.id,
      name: component.name,
      groupName: component.group_name ?? 'Components',
      status: keepExisting ? existing.status : status,
      rawStatus: keepExisting ? existing.rawStatus : rawStatus,
      observedAt: existing && existing.observedAt > observedAt ? existing.observedAt : observedAt,
    });
  };

  input.payload.ongoing_incidents.forEach(incident => {
    incident.affected_components.forEach(component =>
      mergeComponent(
        component,
        normalizeComponentStatus(component.current_status),
        component.current_status ?? 'unknown',
        incident.last_update_at
      )
    );
  });
  input.payload.in_progress_maintenances.forEach(maintenance => {
    maintenance.affected_components.forEach(component =>
      mergeComponent(component, 'maintenance', maintenance.status, maintenance.last_update_at)
    );
  });

  const groupNames = [...new Set([...components.values()].map(component => component.groupName))];
  const groupId = (name: string) => `${input.sourceId}:group:${encodeURIComponent(name)}`;
  const serviceId = (id: string) => `${input.sourceId}:service:${id}`;
  const currentStatuses = [
    ...input.payload.ongoing_incidents.map(incident =>
      normalizeImpact(incident.current_worst_impact)
    ),
    ...input.payload.in_progress_maintenances.map(() => 'maintenance' as const),
  ];
  const allEvents = [
    ...input.payload.ongoing_incidents,
    ...input.payload.in_progress_maintenances,
    ...input.payload.scheduled_maintenances,
  ];
  const sourceUpdatedAt = allEvents
    .map(event => event.last_update_at)
    .sort()
    .at(-1);

  return normalizedSnapshotSchema.parse({
    sourceId: input.sourceId,
    pageId: input.pageId,
    title: input.payload.page_title,
    description: `Read-only incident.io widget snapshot from ${input.payload.page_url}`,
    status: worstStatus(currentStatuses, 'operational'),
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    sourceUpdatedAt: sourceUpdatedAt ?? null,
    capabilities: {
      currentStatus: true,
      heartbeatSeries: false,
      latencySeries: false,
      uptimeWindows: [],
      incidents: 'current',
      maintenance: true,
      groups: true,
      tags: false,
      nativeMetrics: false,
      historicalDays: null,
    },
    groups: groupNames.map((name, position) => ({
      id: groupId(name),
      name,
      position,
      serviceIds: [...components.values()]
        .filter(component => component.groupName === name)
        .map(component => serviceId(component.id)),
    })),
    services: [...components.values()].map(component => ({
      id: serviceId(component.id),
      sourceId: input.sourceId,
      upstreamId: component.id,
      name: component.name,
      groupId: groupId(component.groupName),
      tags: [],
      status: component.status,
      rawStatus: component.rawStatus,
      latencyMs: null,
      observedAt: component.observedAt,
      uptime24h: null,
    })),
    incidents: [
      ...input.payload.ongoing_incidents.map(incident => ({
        id: `${input.sourceId}:incident:${incident.id}`,
        title: incident.name,
        content: incident.last_update_message,
        severity:
          incident.current_worst_impact === 'full_outage'
            ? ('danger' as const)
            : incident.current_worst_impact === 'partial_outage' ||
                incident.current_worst_impact === 'degraded_performance'
              ? ('warning' as const)
              : ('unknown' as const),
        startedAt: null,
        updatedAt: incident.last_update_at,
        rawStatus: incident.status,
      })),
      ...input.payload.in_progress_maintenances.map(maintenance => ({
        id: `${input.sourceId}:maintenance:${maintenance.id}`,
        title: maintenance.name,
        content: maintenance.last_update_message,
        severity: 'info' as const,
        startedAt: maintenance.started_at,
        updatedAt: maintenance.last_update_at,
        rawStatus: maintenance.status,
      })),
      ...input.payload.scheduled_maintenances.map(maintenance => ({
        id: `${input.sourceId}:maintenance:${maintenance.id}`,
        title: maintenance.name,
        content: maintenance.last_update_message,
        severity: 'info' as const,
        startedAt: maintenance.starts_at,
        updatedAt: maintenance.last_update_at,
        rawStatus: maintenance.status,
      })),
    ],
  });
};

export const fetchIncidentIoSnapshot = async (
  input: { sourceId: string; baseUrl: string; pageId: string },
  requester: SourceJsonRequester
) => {
  if (input.pageId !== 'summary') {
    throw Object.assign(new Error('incident.io Widget mode supports only the summary snapshot'), {
      code: 'unsupported_page_type',
    });
  }
  let payload: IncidentIoSummary;
  try {
    payload = await requester.request(
      new URL('/api/v1/summary', new URL(input.baseUrl)),
      'widget:summary',
      incidentIoSummarySchema
    );
  } catch (error) {
    const code =
      typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : null;
    if (code === 'http_403' || code === 'http_404') {
      throw Object.assign(
        new Error('incident.io Widget API is unavailable for this status page type'),
        { code: 'unsupported_page_type' }
      );
    }
    throw error;
  }
  return normalizeIncidentIoSummary({ ...input, payload });
};

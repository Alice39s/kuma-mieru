import type { NormalizedSnapshot, NormalizedStatus } from '../types.js';
import {
  betterStackResourceSchema,
  betterStackSectionSchema,
  betterStackStatusReportSchema,
  betterStackStatusUpdateSchema,
  type BetterStackStatusPage,
} from './schemas.js';

const normalizeStatus = (status: string): NormalizedStatus => {
  switch (status) {
    case 'operational':
      return 'operational';
    case 'degraded':
      return 'degraded';
    case 'downtime':
    case 'major_outage':
      return 'major_outage';
    case 'partial_outage':
      return 'partial_outage';
    case 'maintenance':
      return 'maintenance';
    default:
      return 'unknown';
  }
};

export const normalizeBetterStackSnapshot = (input: {
  sourceId: string;
  pageId: string;
  payload: BetterStackStatusPage;
  fetchedAt?: string;
}): NormalizedSnapshot => {
  const sections = input.payload.included
    .filter(item => item.type === 'status_page_section')
    .map(item => betterStackSectionSchema.parse(item));
  const resources = input.payload.included
    .filter(item => item.type === 'status_page_resource')
    .map(item => betterStackResourceSchema.parse(item));
  const updates = new Map(
    input.payload.included
      .filter(item => item.type === 'status_update')
      .map(item => betterStackStatusUpdateSchema.parse(item))
      .map(update => [update.id, update] as const)
  );
  const reports = input.payload.included
    .filter(item => item.type === 'status_report')
    .map(item => betterStackStatusReportSchema.parse(item));
  const serviceId = (resourceId: string) => `${input.sourceId}:service:${resourceId}`;
  const groupId = (sectionId: string | number) => `${input.sourceId}:group:${sectionId}`;
  const services = resources
    .sort((left, right) => left.attributes.position - right.attributes.position)
    .map(resource => ({
      id: serviceId(resource.id),
      sourceId: input.sourceId,
      upstreamId: resource.id,
      name: resource.attributes.public_name,
      groupId: groupId(resource.attributes.status_page_section_id),
      tags: [],
      status: normalizeStatus(resource.attributes.status),
      rawStatus: resource.attributes.status,
      latencyMs: null,
      observedAt: input.payload.data.attributes.updated_at,
      uptime24h: null,
    }));
  return {
    sourceId: input.sourceId,
    pageId: input.pageId,
    title: input.payload.data.attributes.company_name,
    description: '',
    status: normalizeStatus(input.payload.data.attributes.aggregate_state),
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    sourceUpdatedAt: input.payload.data.attributes.updated_at,
    extensions: {},
    capabilities: {
      currentStatus: true,
      heartbeatSeries: false,
      latencySeries: false,
      uptimeWindows: ['90d'],
      incidents: 'history',
      maintenance: true,
      groups: true,
      tags: false,
      nativeMetrics: false,
      historicalDays: 90,
    },
    groups: sections
      .sort((left, right) => left.attributes.position - right.attributes.position)
      .map(section => ({
        id: groupId(section.id),
        name: section.attributes.name,
        position: section.attributes.position,
        serviceIds: resources
          .filter(resource => String(resource.attributes.status_page_section_id) === section.id)
          .sort((left, right) => left.attributes.position - right.attributes.position)
          .map(resource => serviceId(resource.id)),
      })),
    services,
    incidents: reports.map(report => {
      const relatedUpdates =
        report.relationships?.status_updates.data
          .map(reference => updates.get(reference.id))
          .filter(update => update !== undefined) ?? [];
      const latestUpdate = relatedUpdates.at(-1);
      const rawStatus = report.attributes.aggregate_state;
      return {
        id: `${input.sourceId}:incident:${report.id}`,
        sourceEventId: report.id,
        kind: 'incident' as const,
        title: report.attributes.title,
        content: relatedUpdates.map(update => update.attributes.message).join('\n\n'),
        severity:
          rawStatus === 'downtime' || rawStatus === 'major_outage'
            ? ('danger' as const)
            : rawStatus === 'degraded'
              ? ('warning' as const)
              : ('info' as const),
        startedAt: report.attributes.starts_at,
        updatedAt: latestUpdate?.attributes.published_at ?? report.attributes.ends_at,
        rawStatus,
      };
    }),
  };
};

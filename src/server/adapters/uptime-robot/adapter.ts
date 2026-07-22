import type { z } from 'zod';
import {
  normalizedSnapshotSchema,
  type NormalizedStatus,
  type SourceJsonRequester,
} from '../types.js';
import {
  uptimeRobotGroupPageSchema,
  uptimeRobotMonitorPageSchema,
  type UptimeRobotGroupPage,
  type UptimeRobotMonitorPage,
} from './schemas.js';

const normalizeStatus = (status: string): NormalizedStatus => {
  switch (status.toUpperCase()) {
    case 'UP':
      return 'operational';
    case 'LOOKS_DOWN':
      return 'degraded';
    case 'DOWN':
      return 'major_outage';
    case 'PAUSED':
      return 'paused';
    case 'STARTED':
      return 'pending';
    default:
      return 'unknown';
  }
};

const statusPriority: Record<NormalizedStatus, number> = {
  major_outage: 7,
  partial_outage: 6,
  degraded: 5,
  maintenance: 4,
  unknown: 3,
  pending: 2,
  paused: 1,
  operational: 0,
};

const aggregateStatus = (statuses: NormalizedStatus[]): NormalizedStatus =>
  statuses.length === 0
    ? 'unknown'
    : statuses.reduce<NormalizedStatus>(
        (worst, status) => (statusPriority[status] > statusPriority[worst] ? status : worst),
        'operational'
      );

const endpointUrl = (baseUrl: string, path: string) => {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  return new URL(path, base);
};

const nextCursor = (nextLink: string | null, endpoint: URL) => {
  if (!nextLink) return null;
  const next = new URL(nextLink, endpoint);
  if (next.origin !== endpoint.origin || next.pathname !== endpoint.pathname) {
    throw Object.assign(new Error('UptimeRobot pagination left the expected API endpoint'), {
      code: 'invalid_pagination_link',
    });
  }
  const cursor = next.searchParams.get('cursor');
  if (!cursor || !/^\d+$/u.test(cursor)) {
    throw Object.assign(new Error('UptimeRobot pagination cursor is invalid'), {
      code: 'invalid_pagination_cursor',
    });
  }
  return cursor;
};

const readPages = async <T>(input: {
  endpoint: URL;
  resource: string;
  token: string;
  requester: SourceJsonRequester;
  schema: z.ZodType<{ nextLink: string | null; data: T[] }>;
  initialQuery?: Record<string, string>;
}) => {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const url = new URL(input.endpoint);
    Object.entries(input.initialQuery ?? {}).forEach(([key, value]) =>
      url.searchParams.set(key, value)
    );
    if (cursor) url.searchParams.set('cursor', cursor);
    const payload = await input.requester.request(
      url,
      `${input.resource}:${cursor ?? 'first'}`,
      input.schema,
      { headers: { Authorization: `Bearer ${input.token}` } }
    );
    items.push(...payload.data);
    const next = nextCursor(payload.nextLink, input.endpoint);
    if (!next) return items;
    if (seen.has(next)) {
      throw Object.assign(new Error('UptimeRobot pagination cursor repeated'), {
        code: 'pagination_loop',
      });
    }
    seen.add(next);
    cursor = next;
  }
  throw Object.assign(new Error('UptimeRobot pagination exceeded 100 pages'), {
    code: 'pagination_limit_exceeded',
  });
};

export const fetchUptimeRobotSnapshot = async (
  input: { sourceId: string; baseUrl: string; pageId: string; token: string },
  requester: SourceJsonRequester
) => {
  if (input.pageId !== 'all' && !/^\d+$/u.test(input.pageId)) {
    throw Object.assign(new Error('UptimeRobot pageId must be all or a monitor group ID'), {
      code: 'invalid_page_id',
    });
  }
  const monitorEndpoint = endpointUrl(input.baseUrl, 'monitors');
  const groupEndpoint = endpointUrl(input.baseUrl, 'monitor-groups');
  const [monitors, upstreamGroups] = await Promise.all([
    readPages<UptimeRobotMonitorPage['data'][number]>({
      endpoint: monitorEndpoint,
      resource: 'monitors',
      token: input.token,
      requester,
      schema: uptimeRobotMonitorPageSchema,
      initialQuery: {
        limit: '200',
        ...(input.pageId === 'all' ? {} : { groupId: input.pageId }),
      },
    }),
    readPages<UptimeRobotGroupPage['data'][number]>({
      endpoint: groupEndpoint,
      resource: 'monitor-groups',
      token: input.token,
      requester,
      schema: uptimeRobotGroupPageSchema,
    }),
  ]);
  const groupNames = new Map(upstreamGroups.map(group => [group.id, group.name]));
  const groupKey = (groupId: number | null | undefined) => groupId ?? 0;
  const groupId = (upstreamId: number) => `${input.sourceId}:group:${upstreamId}`;
  const serviceId = (upstreamId: number) => `${input.sourceId}:service:${upstreamId}`;
  const groupKeys = [...new Set(monitors.map(monitor => groupKey(monitor.groupId)))];
  const services = monitors.map(monitor => {
    const samples = monitor.lastDayUptimes.histogram.map(sample => sample.uptime);
    return {
      id: serviceId(monitor.id),
      sourceId: input.sourceId,
      upstreamId: String(monitor.id),
      name: monitor.friendlyName,
      groupId: groupId(groupKey(monitor.groupId)),
      tags: monitor.tags.map(tag => ({ name: tag.name, color: tag.color })),
      status: normalizeStatus(monitor.status),
      rawStatus: monitor.status,
      latencyMs: null,
      observedAt: null,
      uptime24h:
        samples.length === 0
          ? null
          : samples.reduce((total, value) => total + value, 0) / samples.length,
    };
  });
  const selectedGroup =
    input.pageId === 'all' ? null : upstreamGroups.find(group => String(group.id) === input.pageId);
  if (input.pageId !== 'all' && !selectedGroup) {
    throw Object.assign(new Error('UptimeRobot monitor group does not exist'), {
      code: 'source_page_not_found',
    });
  }
  return normalizedSnapshotSchema.parse({
    sourceId: input.sourceId,
    pageId: input.pageId,
    title: selectedGroup?.name ?? 'UptimeRobot',
    description: 'Read-only UptimeRobot v3 monitor snapshot',
    status: aggregateStatus(services.map(service => service.status)),
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: null,
    capabilities: {
      currentStatus: true,
      heartbeatSeries: false,
      latencySeries: false,
      uptimeWindows: ['24h'],
      incidents: 'none',
      maintenance: false,
      groups: true,
      tags: true,
      nativeMetrics: false,
      historicalDays: 1,
    },
    groups: groupKeys.map((key, position) => ({
      id: groupId(key),
      name: key === 0 ? 'Default' : (groupNames.get(key) ?? `Group ${key}`),
      position,
      serviceIds: monitors
        .filter(monitor => groupKey(monitor.groupId) === key)
        .map(monitor => serviceId(monitor.id)),
    })),
    services,
    incidents: [],
  });
};

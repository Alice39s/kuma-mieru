import {
  normalizedSnapshotSchema,
  type NormalizedStatus,
  type SourceJsonRequester,
} from '../types.js';
import {
  llmMieruIncidentsSchema,
  llmMieruMetaSchema,
  llmMieruServicesSchema,
  llmMieruStatusSnapshotSchema,
} from './schemas.js';

const supportedApiMajor = '1';

const normalizeStatus = (status: string): NormalizedStatus => {
  switch (status) {
    case 'operational':
    case 'degraded':
    case 'partial_outage':
    case 'major_outage':
    case 'maintenance':
      return status;
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
  pending: 4,
  paused: 3,
  operational: 1,
};

const aggregateStatus = (statuses: NormalizedStatus[]) =>
  statuses.length === 0
    ? ('unknown' as const)
    : statuses.reduce<NormalizedStatus>(
        (worst, status) => (statusPriority[status] > statusPriority[worst] ? status : worst),
        'operational'
      );

const severity = (input: string) => {
  switch (input) {
    case 'critical':
    case 'major':
      return 'danger' as const;
    case 'minor':
    case 'warning':
      return 'warning' as const;
    case 'info':
      return 'info' as const;
    default:
      return 'unknown' as const;
  }
};

const endpoint = (baseUrl: string, path: string) => new URL(path, new URL(baseUrl));

export const fetchLlmMieruSnapshot = async (
  input: { sourceId: string; baseUrl: string; pageId: string; token?: string },
  requester: SourceJsonRequester
) => {
  if (input.pageId !== 'default') {
    throw Object.assign(new Error('LLM-Mieru supports only the default catalog snapshot'), {
      code: 'unsupported_page_type',
    });
  }
  const requestOptions = input.token
    ? { headers: { Authorization: `Bearer ${input.token}` } }
    : undefined;
  const meta = await requester.request(
    endpoint(input.baseUrl, '/api/v1/meta'),
    'meta',
    llmMieruMetaSchema,
    requestOptions
  );
  if (meta.apiVersion.split('.')[0] !== supportedApiMajor) {
    throw Object.assign(new Error(`Unsupported LLM-Mieru API version ${meta.apiVersion}`), {
      code: 'unsupported_version',
    });
  }
  const [catalog, status, incidents] = await Promise.all([
    requester.request(
      endpoint(input.baseUrl, '/api/v1/services'),
      'services',
      llmMieruServicesSchema,
      requestOptions
    ),
    requester.request(
      endpoint(input.baseUrl, '/api/v1/status/snapshot'),
      'status:snapshot',
      llmMieruStatusSnapshotSchema,
      requestOptions
    ),
    meta.features.includes('incidents')
      ? requester.request(
          endpoint(input.baseUrl, '/api/v1/incidents'),
          'incidents',
          llmMieruIncidentsSchema,
          requestOptions
        )
      : Promise.resolve({ data: [] }),
  ]);
  const statusByService = new Map(status.data.map(item => [item.serviceId, item]));
  const groupNames = [...new Set(catalog.data.map(service => service.dimensions.macro_region))];
  const groupId = (name: string) => `${input.sourceId}:group:${encodeURIComponent(name)}`;
  const serviceId = (id: string) => `${input.sourceId}:service:${id}`;
  const services = catalog.data.map(service => {
    const state = statusByService.get(service.id);
    const normalized =
      !state || state.freshness !== 'fresh' ? 'unknown' : normalizeStatus(state.status);
    return {
      id: serviceId(service.id),
      sourceId: input.sourceId,
      upstreamId: service.id,
      name: service.name,
      groupId: groupId(service.dimensions.macro_region),
      tags: [
        { name: 'provider_route', value: service.dimensions.provider_route, color: '#64748b' },
        { name: 'model', value: service.dimensions.model, color: '#2563eb' },
        { name: 'scenario', value: service.dimensions.scenario, color: '#7c3aed' },
        { name: 'observed_region', value: service.dimensions.observed_region, color: '#059669' },
        {
          name: 'protocol_version',
          value: state?.protocolVersion ?? 'unknown',
          color: '#d97706',
        },
      ],
      status: normalized,
      rawStatus: state?.rawStatus ?? 'missing',
      latencyMs: null,
      observedAt: state?.observedAt ?? null,
      uptime24h: null,
    };
  });

  return normalizedSnapshotSchema.parse({
    sourceId: input.sourceId,
    pageId: input.pageId,
    title: 'LLM-Mieru',
    description: `LLM-Mieru instance ${meta.instanceId}`,
    status: aggregateStatus(services.map(service => service.status)),
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: status.generatedAt,
    extensions: {
      'llm-mieru': {
        apiVersion: meta.apiVersion,
        schemaVersion: meta.schemaVersion,
        protocolVersions: meta.protocolVersions,
        upstreamFeatures: meta.features,
        coverageGeneratedAt: status.coverageGeneratedAt,
      },
    },
    capabilities: {
      currentStatus: true,
      heartbeatSeries: false,
      latencySeries: false,
      uptimeWindows: [],
      incidents: meta.features.includes('incidents') ? 'history' : 'none',
      maintenance: false,
      groups: true,
      tags: true,
      nativeMetrics: false,
      historicalDays: null,
    },
    groups: groupNames.map((name, position) => ({
      id: groupId(name),
      name,
      position,
      serviceIds: catalog.data
        .filter(service => service.dimensions.macro_region === name)
        .map(service => serviceId(service.id)),
    })),
    services,
    incidents: incidents.data.map(incident => ({
      id: `${input.sourceId}:incident:${incident.id}`,
      title: incident.title,
      content: incident.summary,
      severity: severity(incident.severity),
      startedAt: incident.startedAt,
      updatedAt: incident.updatedAt,
      rawStatus: incident.status,
    })),
  });
};

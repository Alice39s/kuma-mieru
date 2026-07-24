import {
  metricExtensionSchema,
  normalizedSnapshotSchema,
  type MetricExtension,
  type MethodologySnapshot,
  type NormalizedStatus,
  type SourceJsonRequester,
} from '../types.js';
import {
  llmMieruIncidentsSchema,
  llmMieruMetaSchema,
  llmMieruMethodologySchema,
  llmMieruMetricCatalogSchema,
  llmMieruMetricQuerySchema,
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
    case 'major_outage':
      return 'danger' as const;
    case 'minor':
    case 'warning':
    case 'degraded':
    case 'partial_outage':
      return 'warning' as const;
    case 'info':
      return 'info' as const;
    default:
      return 'unknown' as const;
  }
};

const endpoint = (baseUrl: string, path: string) => new URL(path, new URL(baseUrl));

const requestOptions = (token?: string) =>
  token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;

const supportsMetrics = (features: string[]) =>
  features.includes('metric-catalog') && features.includes('metric-query');

const metricPresentationHint = (unit: string) => {
  switch (unit) {
    case 'ratio':
      return 'ratio';
    case 'milliseconds':
    case 'tokens_per_second':
      return 'distribution';
    case 'currency_micros':
      return 'currency';
    default:
      return 'scalar';
  }
};

export const fetchLlmMieruMetrics = async (
  input: {
    sourceId: string;
    baseUrl: string;
    token?: string;
    features: string[];
    window?: string;
  },
  requester: SourceJsonRequester
): Promise<MetricExtension | null> => {
  if (!supportsMetrics(input.features)) return null;
  const window = input.window ?? '5m';
  const options = requestOptions(input.token);
  const catalog = await requester.request(
    endpoint(input.baseUrl, '/api/v1/metrics/catalog'),
    'metrics:catalog',
    llmMieruMetricCatalogSchema,
    options
  );
  const queries = [];
  for (let offset = 0; offset < catalog.data.length; offset += 4) {
    const batch = catalog.data.slice(offset, offset + 4);
    queries.push(
      ...(await Promise.all(
        batch.map(definition => {
          const url = endpoint(input.baseUrl, '/api/v1/metrics/query');
          url.searchParams.set('metric', definition.id);
          url.searchParams.set('window', window);
          return requester.request(
            url,
            `metrics:${definition.id}:${window}`,
            llmMieruMetricQuerySchema,
            options
          );
        })
      ))
    );
  }
  const definitionsById = new Map(catalog.data.map(definition => [definition.id, definition]));
  return metricExtensionSchema.parse({
    catalog: catalog.data.map(definition => ({
      id: definition.id,
      unit: definition.unit,
      minimumSamples: definition.minimumSamples,
      requiredScenario: definition.requiredScenario,
      presentationHint: metricPresentationHint(definition.unit),
    })),
    series: queries.map(query => ({
      metricId: query.metric,
      unit: definitionsById.get(query.metric)?.unit ?? 'unknown',
      window,
      generatedAt: query.generatedAt,
      points: query.data,
    })),
  });
};

export const fetchLlmMieruMethodology = (
  input: { baseUrl: string; token?: string; features: string[] },
  requester: SourceJsonRequester
): Promise<MethodologySnapshot | null> => {
  if (!input.features.includes('methodology')) return Promise.resolve(null);
  return requester.request(
    endpoint(input.baseUrl, '/api/v1/methodology/protocols'),
    'methodology:protocols',
    llmMieruMethodologySchema,
    requestOptions(input.token)
  );
};

export const fetchLlmMieruSnapshot = async (
  input: { sourceId: string; baseUrl: string; pageId: string; token?: string },
  requester: SourceJsonRequester
) => {
  if (input.pageId !== 'default') {
    throw Object.assign(new Error('LLM-Mieru supports only the default catalog snapshot'), {
      code: 'unsupported_page_type',
    });
  }
  const options = requestOptions(input.token);
  const meta = await requester.request(
    endpoint(input.baseUrl, '/api/v1/meta'),
    'meta',
    llmMieruMetaSchema,
    options
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
      options
    ),
    requester.request(
      endpoint(input.baseUrl, '/api/v1/status/snapshot'),
      'status:snapshot',
      llmMieruStatusSnapshotSchema,
      options
    ),
    meta.features.includes('automatic-incidents')
      ? requester.request(
          endpoint(input.baseUrl, '/api/v1/incidents'),
          'incidents',
          llmMieruIncidentsSchema,
          options
        )
      : Promise.resolve({ data: [] }),
  ]);
  const catalogByService = new Map(catalog.data.map(item => [item.id, item]));
  const regions = status.data.flatMap(service =>
    service.regions.map(region => ({ service, region }))
  );
  const groupNames = [...new Set(regions.map(item => item.region.macroRegion))];
  const groupId = (name: string) => `${input.sourceId}:group:${encodeURIComponent(name)}`;
  const serviceId = (id: string, region: string) =>
    `${input.sourceId}:service:${encodeURIComponent(id)}:${encodeURIComponent(region)}`;
  const services = regions.map(({ service, region }) => {
    const catalogService = catalogByService.get(service.id);
    const normalized =
      region.freshnessState !== 'fresh' || region.coverageState !== 'active'
        ? 'unknown'
        : normalizeStatus(region.status);
    return {
      id: serviceId(service.id, region.observedRegion),
      sourceId: input.sourceId,
      upstreamId: `${service.id}:${region.observedRegion}`,
      name: `${service.providerRoute} · ${service.requestedModel} · ${region.observedRegion}`,
      groupId: groupId(region.macroRegion),
      tags: [
        { name: 'provider_route', value: service.providerRoute, color: '#64748b' },
        { name: 'model', value: service.requestedModel, color: '#2563eb' },
        { name: 'observed_region', value: region.observedRegion, color: '#059669' },
        { name: 'macro_region', value: region.macroRegion, color: '#7c3aed' },
        {
          name: 'protocol_version',
          value: service.protocolVersion,
          color: '#d97706',
        },
      ],
      status: normalized,
      rawStatus: region.status,
      latencyMs: null,
      observedAt: service.observedAt ?? catalogService?.observedAt ?? null,
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
      incidents: meta.features.includes('automatic-incidents') ? 'history' : 'none',
      maintenance: false,
      groups: true,
      tags: true,
      nativeMetrics: supportsMetrics(meta.features),
      historicalDays: null,
    },
    groups: groupNames.map((name, position) => ({
      id: groupId(name),
      name,
      position,
      serviceIds: catalog.data.flatMap(
        service =>
          status.data
            .find(candidate => candidate.id === service.id)
            ?.regions.filter(region => region.macroRegion === name)
            .map(region => serviceId(service.id, region.observedRegion)) ?? []
      ),
    })),
    services,
    incidents: incidents.data.map(incident => ({
      id: `${input.sourceId}:incident:${incident.id}`,
      title: `${incident.providerRoute} · ${incident.requestedModel}`,
      content: `Automatic incident · ${incident.ruleVersion}`,
      severity: severity(incident.severity),
      startedAt: incident.openedAt,
      updatedAt: incident.updatedAt,
      rawStatus: incident.state,
    })),
  });
};

export interface PublicPage {
  id: string;
  slug: string;
  title: string;
  sourceRefs: string[];
}

export interface RuntimeMeta {
  version: string;
  schemaVersion: number;
  config: {
    mode: 'compatibility' | 'managed' | 'file';
    revision: number | null;
    contentHash: string;
    loadedAt: string;
    reload: {
      state: 'ready' | 'checking' | 'failed';
      lastAttemptAt: string | null;
      lastSuccessAt: string;
      lastErrorCode: string | null;
    } | null;
  };
  capabilities: {
    managedConfig: boolean;
    fileConfig: boolean;
    legacyEnvironment: boolean;
    sourceAdapters: string[];
    emailSubscriptions: boolean;
  };
}

export interface SourceSnapshotState {
  snapshot: {
    sourceId: string;
    pageId: string;
    title: string;
    description: string;
    status: string;
    fetchedAt: string;
    extensions: Record<string, unknown>;
    capabilities: {
      nativeMetrics: boolean;
    };
    groups: Array<{ id: string; name: string; position: number; serviceIds: string[] }>;
    services: Array<{
      id: string;
      name: string;
      status: string;
      latencyMs: number | null;
      observedAt: string | null;
      uptime24h: number | null;
    }>;
    incidents: Array<{
      id: string;
      sourceEventId: string;
      kind: 'incident' | 'maintenance';
      title: string;
      content: string;
      severity: string;
    }>;
  };
  health: {
    state: 'healthy' | 'stale' | 'unavailable';
    stale: boolean;
    staleAfter: string;
    lastSuccessAt: string | null;
    errorCode: string | null;
  };
}

const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export const loadPublicBootstrap = async () => {
  const [meta, pages] = await Promise.all([
    getJson<RuntimeMeta>('/api/v1/meta'),
    getJson<{ data: PublicPage[] }>('/api/v1/public/pages'),
  ]);
  return { meta, pages: pages.data };
};

export const loadStatusSnapshot = async ({
  params,
}: {
  params: Record<string, string | undefined>;
}) => {
  const slug = params.pageSlug ?? params.pageId;
  if (!slug) return null;
  const response = await fetch(`/api/v1/public/pages/${encodeURIComponent(slug)}/snapshot`, {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 503) return null;
  if (!response.ok) throw new Error(`Snapshot request failed with status ${response.status}`);
  return response.json() as Promise<{
    data: SourceSnapshotState[];
    meta: { status: 'ok' | 'partial' };
  }>;
};

export interface PublicMirroredEvent {
  id: string;
  origin: 'mirrored';
  notificationEligible: false;
  type: 'incident' | 'maintenance';
  presence: 'present' | 'absent';
  version: number;
  title: string;
  content: string;
  severity: 'info' | 'warning' | 'danger' | 'unknown';
  startedAt: string | null;
  sourceUpdatedAt: string | null;
  rawStatus: string;
  firstSeenAt: string;
  lastSeenAt: string;
  absentAt: string | null;
  updatedAt: string;
  source: {
    id: string;
    pageId: string;
    eventId: string;
    url: string | null;
  };
}

export const loadStatusPage = async (input: { params: Record<string, string | undefined> }) => {
  const slug = input.params.pageSlug ?? input.params.pageId;
  if (!slug) return { snapshot: null, mirroredEvents: [] };
  const [snapshot, mirrored] = await Promise.all([
    loadStatusSnapshot(input),
    getJson<{ data: PublicMirroredEvent[] }>(
      `/api/v1/public/pages/${encodeURIComponent(slug)}/mirrored-events`
    ),
  ]);
  return { snapshot, mirroredEvents: mirrored.data };
};

export type StatusPagePayload = Awaited<ReturnType<typeof loadStatusPage>>;

export type PublicBootstrap = Awaited<ReturnType<typeof loadPublicBootstrap>>;

export interface MetricDefinition {
  id: string;
  unit: string;
  minimumSamples: number | Record<string, number>;
  requiredScenario?: string;
  presentationHint?: string;
}

export interface MetricCatalogSource {
  sourceId: string;
  pageId: string;
  metrics: MetricDefinition[];
  windows: Array<{
    window: '5m' | '1h' | '1d' | '7d' | '30d';
    fetchedAt: string;
    staleAfter: string;
    stale: boolean;
  }>;
}

export interface MetricPoint {
  window: { start: string; end: string };
  dimensions: Record<string, string | number | boolean | null>;
  protocolVersion: string;
  sampleCount: number;
  eligibleCount: number;
  value: Record<string, unknown>;
  freshness: {
    state: string;
    observedAt?: string | null;
    staleAfter?: string | null;
  };
  coverageState: string;
  limitations: string[];
}

export interface MetricSeries {
  sourceId: string;
  pageId: string;
  metricId: string;
  unit: string;
  window: string;
  generatedAt: string;
  fetchedAt: string;
  staleAfter: string;
  stale: boolean;
  points: MetricPoint[];
}

export interface MethodologySnapshot {
  methodologyVersion: string;
  generatedAt: string;
  product: Record<string, unknown>;
  sourceKinds: string[];
  statusSemantics: Record<string, unknown>;
  freshnessPolicy: Record<string, unknown>;
  protocols: Array<Record<string, unknown>>;
  metrics: Array<Record<string, unknown>>;
  coverage: Array<Record<string, unknown>>;
  limitations: string[];
  evidenceLinks: string[];
  [key: string]: unknown;
}

export interface MethodologySource {
  sourceId: string;
  pageId: string;
  fetchedAt: string;
  staleAfter: string;
  stale: boolean;
  snapshot: MethodologySnapshot;
}

export const loadMetricCatalog = async (slug: string) =>
  getJson<{ data: MetricCatalogSource[] }>(
    `/api/v1/public/pages/${encodeURIComponent(slug)}/metrics/catalog`
  );

export const loadMetricSeries = async (
  slug: string,
  input: { sourceId: string; metricId: string; window?: string }
) => {
  const query = new URLSearchParams({
    source: input.sourceId,
    metric: input.metricId,
    window: input.window ?? '5m',
  });
  return getJson<{ data: MetricSeries[] }>(
    `/api/v1/public/pages/${encodeURIComponent(slug)}/metrics/query?${query}`
  );
};

export const loadMethodology = async (slug: string) =>
  getJson<{ data: MethodologySource[]; meta: { status: 'ok' | 'stale' } }>(
    `/api/v1/public/pages/${encodeURIComponent(slug)}/methodology`
  );

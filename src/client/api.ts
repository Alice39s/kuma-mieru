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
    incidents: Array<{ id: string; title: string; content: string; severity: string }>;
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
  fetchedAt: string;
  staleAfter: string;
  stale: boolean;
  metrics: MetricDefinition[];
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

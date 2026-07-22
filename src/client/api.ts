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

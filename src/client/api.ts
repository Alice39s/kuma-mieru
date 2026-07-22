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
  };
  capabilities: {
    managedConfig: boolean;
    fileConfig: boolean;
    legacyEnvironment: boolean;
    sourceAdapters: string[];
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

export type PublicBootstrap = Awaited<ReturnType<typeof loadPublicBootstrap>>;

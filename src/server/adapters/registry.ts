import type { CanonicalConfig } from '../config/schema.js';
import { fetchBetterStackSnapshot } from './better-stack/adapter.js';
import type { NormalizedSnapshot, SourceJsonRequester } from './types.js';
import { fetchUptimeKumaSnapshot } from './uptime-kuma/adapter.js';

export const fetchSourceSnapshot = (
  source: CanonicalConfig['sources'][number],
  pageId: string,
  requester: SourceJsonRequester
): Promise<NormalizedSnapshot> => {
  const input = { sourceId: source.id, baseUrl: source.baseUrl, pageId };
  switch (source.kind) {
    case 'uptime-kuma':
      return fetchUptimeKumaSnapshot(input, requester);
    case 'better-stack':
      return fetchBetterStackSnapshot(input, requester);
  }
};

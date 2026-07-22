import type { CanonicalConfig } from '../config/schema.js';
import type { SecretStore } from '../secrets/store.js';
import { fetchBetterStackSnapshot } from './better-stack/adapter.js';
import { fetchIncidentIoSnapshot } from './incident-io/adapter.js';
import type { NormalizedSnapshot, SourceJsonRequester } from './types.js';
import { fetchUptimeKumaSnapshot } from './uptime-kuma/adapter.js';
import { fetchUptimeRobotSnapshot } from './uptime-robot/adapter.js';

export const fetchSourceSnapshot = (
  source: CanonicalConfig['sources'][number],
  pageId: string,
  requester: SourceJsonRequester,
  secretStore?: SecretStore
): Promise<NormalizedSnapshot> => {
  const input = { sourceId: source.id, baseUrl: source.baseUrl, pageId };
  switch (source.kind) {
    case 'uptime-kuma':
      return fetchUptimeKumaSnapshot(input, requester);
    case 'better-stack':
      return fetchBetterStackSnapshot(input, requester);
    case 'incident-io':
      return fetchIncidentIoSnapshot(input, requester);
    case 'uptime-robot': {
      if (!secretStore) {
        throw Object.assign(new Error('UptimeRobot requires the encrypted secret store'), {
          code: 'secret_store_unavailable',
        });
      }
      const token = secretStore.resolve(source.secretRef, {
        resourceId: source.id,
        fieldName: 'apiToken',
        purpose: 'source-token',
      });
      return fetchUptimeRobotSnapshot({ ...input, token }, requester);
    }
  }
};

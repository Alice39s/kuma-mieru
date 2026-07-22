import {
  normalizedSnapshotSchema,
  type NormalizedSnapshot,
  type SourceJsonRequester,
} from '../types.js';
import { normalizeUptimeKumaSnapshot } from './normalize.js';
import { uptimeKumaHeartbeatSchema, uptimeKumaPageSchema } from './schemas.js';

export type { SourceJsonRequester } from '../types.js';

export interface FetchUptimeKumaInput {
  sourceId: string;
  baseUrl: string;
  pageId: string;
}

export const fetchUptimeKumaSnapshot = async (
  input: FetchUptimeKumaInput,
  requester: SourceJsonRequester
): Promise<NormalizedSnapshot> => {
  const baseUrl = new URL(input.baseUrl);
  const pageUrl = new URL(`/api/status-page/${encodeURIComponent(input.pageId)}`, baseUrl);
  const heartbeatUrl = new URL(
    `/api/status-page/heartbeat/${encodeURIComponent(input.pageId)}`,
    baseUrl
  );
  const [page, heartbeat] = await Promise.all([
    requester.request(pageUrl, `page:${input.pageId}`, uptimeKumaPageSchema),
    requester.request(heartbeatUrl, `heartbeat:${input.pageId}`, uptimeKumaHeartbeatSchema),
  ]);
  return normalizedSnapshotSchema.parse(
    normalizeUptimeKumaSnapshot({
      sourceId: input.sourceId,
      pageId: input.pageId,
      page,
      heartbeat,
    })
  );
};

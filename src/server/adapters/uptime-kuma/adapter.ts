import type { z } from 'zod';
import { normalizedSnapshotSchema, type NormalizedSnapshot } from '../types.js';
import { normalizeUptimeKumaSnapshot } from './normalize.js';
import { uptimeKumaHeartbeatSchema, uptimeKumaPageSchema } from './schemas.js';

export interface SourceJsonRequester {
  request<T>(url: URL, resourceKey: string, schema: z.ZodType<T>): Promise<T>;
}

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

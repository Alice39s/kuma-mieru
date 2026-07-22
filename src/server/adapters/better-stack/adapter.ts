import {
  normalizedSnapshotSchema,
  type NormalizedSnapshot,
  type SourceJsonRequester,
} from '../types.js';
import { normalizeBetterStackSnapshot } from './normalize.js';
import { betterStackStatusPageSchema } from './schemas.js';

export const fetchBetterStackSnapshot = async (
  input: { sourceId: string; baseUrl: string; pageId: string },
  requester: SourceJsonRequester
): Promise<NormalizedSnapshot> => {
  const url = new URL('/index.json', new URL(input.baseUrl));
  const payload = await requester.request(
    url,
    `index:${input.pageId}`,
    betterStackStatusPageSchema
  );
  return normalizedSnapshotSchema.parse(
    normalizeBetterStackSnapshot({
      sourceId: input.sourceId,
      pageId: input.pageId,
      payload,
    })
  );
};

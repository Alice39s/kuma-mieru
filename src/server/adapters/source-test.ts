import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { sourceSchema, type CanonicalConfig } from '../config/schema.js';
import { createHttpJsonClient } from './http-client.js';
import { fetchSourceSnapshot } from './registry.js';
import type { SourceJsonRequester } from './types.js';
import type { SecretStore } from '../secrets/store.js';

export interface SourceTestResult {
  token: string;
  expiresAt: string;
  pages: Array<{
    pageId: string;
    title: string;
    status: string;
    serviceCount: number;
  }>;
}

export interface SourceTestService {
  test(source: CanonicalConfig['sources'][number]): Promise<SourceTestResult>;
  validate(source: CanonicalConfig['sources'][number], token: string): boolean;
}

export interface CreateSourceTestServiceOptions {
  secret: string;
  privateAddressCidrs?: readonly string[];
  lifetimeMs?: number;
  requester?: SourceJsonRequester;
  secretStore?: SecretStore;
}

const sourceHash = (source: CanonicalConfig['sources'][number]) =>
  createHash('sha256')
    .update(JSON.stringify(sourceSchema.parse(source)), 'utf8')
    .digest('hex');

export const createSourceTestService = ({
  secret,
  privateAddressCidrs = [],
  lifetimeMs = 5 * 60_000,
  requester,
  secretStore,
}: CreateSourceTestServiceOptions): SourceTestService => {
  const sign = (payload: string) =>
    createHmac('sha256', secret).update(`source-test:${payload}`, 'utf8').digest('base64url');

  const test = async (rawSource: CanonicalConfig['sources'][number]) => {
    const source = sourceSchema.parse(rawSource);
    const httpClient = createHttpJsonClient({
      privateAddressCidrs,
      timeoutMs: source.requestPolicy?.timeoutMs,
    });
    const directRequester: SourceJsonRequester =
      requester ??
      ({
        request: async <T>(
          url: URL,
          _resourceKey: string,
          schema: z.ZodType<T>,
          options?: { headers?: Record<string, string> }
        ) => {
          const response = await httpClient(url, options?.headers);
          if (response.status === 304) throw new Error('Unexpected 304 during source test');
          return schema.parse(response.data);
        },
      } satisfies SourceJsonRequester);
    const snapshots = await Promise.all(
      source.pageIds.map(pageId =>
        fetchSourceSnapshot(source, pageId, directRequester, secretStore)
      )
    );
    const expiresAt = new Date(Date.now() + lifetimeMs);
    const payload = Buffer.from(
      JSON.stringify({ sourceHash: sourceHash(source), expiresAt: expiresAt.toISOString() }),
      'utf8'
    ).toString('base64url');
    return {
      token: `${payload}.${sign(payload)}`,
      expiresAt: expiresAt.toISOString(),
      pages: snapshots.map(snapshot => ({
        pageId: snapshot.pageId,
        title: snapshot.title,
        status: snapshot.status,
        serviceCount: snapshot.services.length,
      })),
    };
  };

  const validate = (rawSource: CanonicalConfig['sources'][number], token: string) => {
    const source = sourceSchema.safeParse(rawSource);
    if (!source.success) return false;
    const [payload, signature, ...extra] = token.split('.');
    if (!payload || !signature || extra.length > 0) return false;
    const expected = Buffer.from(sign(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
    try {
      const decoded = z
        .object({ sourceHash: z.string(), expiresAt: z.string().datetime() })
        .parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
      return (
        decoded.sourceHash === sourceHash(source.data) && Date.parse(decoded.expiresAt) > Date.now()
      );
    } catch {
      return false;
    }
  };

  return { test, validate };
};

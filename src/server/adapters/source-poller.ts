import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CanonicalConfig } from '../config/schema.js';
import type { SecretStore } from '../secrets/store.js';
import { createCachedSourceRequester, createHttpJsonClient } from './http-client.js';
import { fetchLlmMieruMetrics } from './llm-mieru/adapter.js';
import { saveMetricExtension } from './metric-store.js';
import { fetchSourceSnapshot } from './registry.js';
import { getSourceSnapshot, recordSourceFailure, saveSourceSnapshot } from './source-store.js';

export interface SourcePollerOptions {
  database: Database.Database;
  config: CanonicalConfig;
  allowPrivateAddresses?: boolean;
  intervalMs?: number;
  staleAfterMs?: number;
  metricRefreshMs?: number;
  metricStaleAfterMs?: number;
  secretStore?: SecretStore;
}

const errorCode = (error: unknown) => {
  if (typeof error === 'object' && error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  if (typeof error === 'object' && error && 'name' in error && error.name === 'ZodError') {
    return 'invalid_upstream_schema';
  }
  return 'source_fetch_failed';
};

const stableJitter = (key: string, intervalMs: number) => {
  const digest = createHash('sha256').update(key).digest();
  return digest.readUInt16BE(0) % Math.max(1, Math.floor(intervalMs / 4));
};

export const startSourcePoller = ({
  database,
  config,
  allowPrivateAddresses = false,
  intervalMs = 60_000,
  staleAfterMs = 180_000,
  metricRefreshMs = 5 * 60_000,
  metricStaleAfterMs = 15 * 60_000,
  secretStore,
}: SourcePollerOptions) => {
  const timers = new Set<NodeJS.Timeout>();
  let stopped = false;

  for (const source of config.sources) {
    const httpClient = createHttpJsonClient({
      allowPrivateAddresses,
      timeoutMs: source.requestPolicy?.timeoutMs,
    });
    for (const pageId of source.pageIds) {
      let consecutiveFailures = 0;
      let lastMetricRefreshAt = 0;
      const requester = createCachedSourceRequester(database, source.id, httpClient);
      const schedule = (callback: () => void, delay: number) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          callback();
        }, delay);
        timer.unref();
        timers.add(timer);
      };
      const run = async () => {
        if (stopped) return;
        try {
          const snapshot = await fetchSourceSnapshot(source, pageId, requester, secretStore);
          saveSourceSnapshot(database, snapshot, new Date(Date.now() + staleAfterMs));
          consecutiveFailures = 0;
          if (
            source.kind === 'llm-mieru' &&
            snapshot.capabilities.nativeMetrics &&
            Date.now() - lastMetricRefreshAt >= metricRefreshMs
          ) {
            const llmMetadata = snapshot.extensions['llm-mieru'];
            const features =
              typeof llmMetadata === 'object' &&
              llmMetadata !== null &&
              'upstreamFeatures' in llmMetadata &&
              Array.isArray(llmMetadata.upstreamFeatures)
                ? llmMetadata.upstreamFeatures.filter(
                    (feature): feature is string => typeof feature === 'string'
                  )
                : [];
            const token = source.secretRef
              ? secretStore?.resolve(source.secretRef, {
                  resourceId: source.id,
                  fieldName: 'apiToken',
                  purpose: 'source-token',
                })
              : undefined;
            try {
              const extension = await fetchLlmMieruMetrics(
                {
                  sourceId: source.id,
                  baseUrl: source.baseUrl,
                  token,
                  features,
                },
                requester
              );
              if (extension) {
                saveMetricExtension(
                  database,
                  source.id,
                  pageId,
                  extension,
                  new Date(Date.now() + metricStaleAfterMs)
                );
              }
              lastMetricRefreshAt = Date.now();
            } catch (metricError) {
              console.warn('Metric extension refresh failed', {
                sourceId: source.id,
                pageId,
                errorCode: errorCode(metricError),
              });
            }
          }
        } catch (error) {
          consecutiveFailures += 1;
          const backoff = Math.min(intervalMs * 2 ** consecutiveFailures, 15 * 60_000);
          recordSourceFailure(
            database,
            source.id,
            pageId,
            errorCode(error),
            new Date(Date.now() + backoff)
          );
        }
        if (!stopped) {
          const delay =
            Math.min(intervalMs * 2 ** consecutiveFailures, 15 * 60_000) +
            stableJitter(`${source.id}:${pageId}`, intervalMs);
          schedule(() => void run(), delay);
        }
      };

      const initialDelay = getSourceSnapshot(database, source.id, pageId)
        ? stableJitter(`${source.id}:${pageId}`, intervalMs)
        : 0;
      schedule(() => void run(), initialDelay);
    }
  }

  return () => {
    stopped = true;
    timers.forEach(timer => clearTimeout(timer));
    timers.clear();
  };
};

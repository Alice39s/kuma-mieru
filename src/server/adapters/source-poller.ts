import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CanonicalConfig } from '../config/schema.js';
import type { SecretStore } from '../secrets/store.js';
import { createCachedSourceRequester, createHttpJsonClient } from './http-client.js';
import { fetchLlmMieruMethodology, fetchLlmMieruMetrics } from './llm-mieru/adapter.js';
import { getMethodologyState, saveMethodology } from './methodology-store.js';
import {
  dueMetricWindows,
  getMetricWindowStates,
  metricWindowRefreshMs,
  saveMetricWindow,
} from './metric-store.js';
import { fetchSourceSnapshot } from './registry.js';
import { getSourceSnapshot, recordSourceFailure, saveSourceSnapshot } from './source-store.js';
import { reconcileSignalAutomation } from '../events/automation-repository.js';
import { reconcileMirroredEvents } from '../events/mirrored-repository.js';

export interface SourcePollerOptions {
  database: Database.Database;
  config: CanonicalConfig;
  privateAddressCidrs?: readonly string[];
  intervalMs?: number;
  staleAfterMs?: number;
  metricStaleMultiplier?: number;
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

const methodologyRefreshMs = 60 * 60_000;

export const startSourcePoller = ({
  database,
  config,
  privateAddressCidrs = [],
  intervalMs = 60_000,
  staleAfterMs = 180_000,
  metricStaleMultiplier = 3,
  secretStore,
}: SourcePollerOptions) => {
  const timers = new Set<NodeJS.Timeout>();
  let stopped = false;

  for (const source of config.sources) {
    const httpClient = createHttpJsonClient({
      privateAddressCidrs,
      timeoutMs: source.requestPolicy?.timeoutMs,
    });
    for (const pageId of source.pageIds) {
      let consecutiveFailures = 0;
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
          try {
            reconcileMirroredEvents(database, snapshot, { sourceUrl: source.baseUrl });
          } catch (mirrorError) {
            console.error('Mirrored event reconciliation failed', {
              sourceId: source.id,
              pageId,
              errorCode: errorCode(mirrorError),
            });
          }
          try {
            reconcileSignalAutomation(database, config, snapshot);
          } catch (automationError) {
            console.error('Signal automation reconciliation failed', {
              sourceId: source.id,
              pageId,
              errorCode: errorCode(automationError),
            });
          }
          consecutiveFailures = 0;
          if (source.kind === 'llm-mieru') {
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
            if (snapshot.capabilities.nativeMetrics) {
              const dueWindows = dueMetricWindows(
                getMetricWindowStates(database, source.id, pageId)
              );
              for (const window of dueWindows) {
                try {
                  const extension = await fetchLlmMieruMetrics(
                    {
                      sourceId: source.id,
                      baseUrl: source.baseUrl,
                      token,
                      features,
                      window,
                    },
                    requester
                  );
                  if (extension) {
                    saveMetricWindow(
                      database,
                      source.id,
                      pageId,
                      window,
                      extension,
                      new Date(Date.now() + metricWindowRefreshMs[window] * metricStaleMultiplier)
                    );
                  }
                } catch (metricError) {
                  console.warn('Metric extension refresh failed', {
                    sourceId: source.id,
                    pageId,
                    window,
                    errorCode: errorCode(metricError),
                  });
                }
              }
            }
            const methodology = getMethodologyState(database, source.id, pageId);
            const methodologyDue =
              features.includes('methodology') &&
              (!methodology ||
                Date.now() - Date.parse(methodology.fetchedAt) >= methodologyRefreshMs);
            if (methodologyDue) {
              try {
                const nextMethodology = await fetchLlmMieruMethodology(
                  { baseUrl: source.baseUrl, token, features },
                  requester
                );
                if (nextMethodology) {
                  saveMethodology(
                    database,
                    source.id,
                    pageId,
                    nextMethodology,
                    new Date(Date.now() + methodologyRefreshMs * 3)
                  );
                }
              } catch (methodologyError) {
                console.warn('Methodology refresh failed', {
                  sourceId: source.id,
                  pageId,
                  errorCode: errorCode(methodologyError),
                });
              }
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

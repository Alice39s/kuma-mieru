'use client';

import { usePageConfig } from '@/components/context/PageConfigContext';
import type { GlobalConfig } from '@/types/config';
import type { MonitorResponse, MonitoringData } from '@/types/monitor';
import type { PageTabMeta, PageTabsStatusMatrix } from '@/types/page';
import { useCallback, useEffect, useRef } from 'react';
import useSWR, { mutate } from 'swr';
import type { SWRConfiguration } from 'swr';

interface ApiEnvelope {
  success?: boolean;
  status?: 'ok' | 'partial' | 'all_failed' | 'partial_failed';
  error?: string;
}

export interface ConfigResponse extends GlobalConfig {
  pageTabs?: PageTabMeta[];
  matrixStatus?: PageTabsStatusMatrix['status'];
  success?: boolean;
  status?: ApiEnvelope['status'];
  failureType?: PageTabMeta['failureType'];
  error?: string;
  timestamp?: number;
}

/**
 * swr 通用 fetcher
 * @param url - 请求的 URL
 * @returns 解析后的 JSON data
 * @throws 请求失败抛出错误
 */
const fetcher = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  const data = (await response.json()) as ApiEnvelope & Record<string, unknown>;

  if (!response.ok) {
    const statusText = response.statusText || 'Unknown Status';
    const errorMessage =
      typeof data.error === 'string' && data.error.length > 0
        ? data.error
        : `Request failed with status ${response.status} ${statusText}`;
    throw new Error(`HTTP ${response.status} ${statusText}: ${errorMessage}`);
  }

  if (data.success === false || data.status === 'all_failed') {
    const statusText = response.statusText || 'Unknown Status';
    const errorMessage =
      typeof data.error === 'string' && data.error.length > 0
        ? data.error
        : `Failed to fetch data from ${url}`;
    throw new Error(`HTTP ${response.status} ${statusText}: ${errorMessage}`);
  }

  return data as T;
};

/**
 * SWR Cache Key
 */
export const SWR_KEYS = {
  MONITOR: (pageId: string) => `/api/monitor?pageId=${encodeURIComponent(pageId)}`,
  CONFIG: (pageId: string) => `/api/config?pageId=${encodeURIComponent(pageId)}`,
};

/**
 * 默认配置
 */
const DEFAULT_SWR_CONFIG: SWRConfiguration = {
  revalidateOnFocus: false, // 保留这个优化
  revalidateOnReconnect: true,
  dedupingInterval: 3000, // 稍微增加防抖时间
  errorRetryCount: 3, // 恢复重试次数以提高可靠性
  errorRetryInterval: 1000,
  loadingTimeout: 5000, // 增加加载超时
};

interface PrefetchOptions {
  ttlMs?: number;
  force?: boolean;
}

interface IntentPrefetchOptions extends PrefetchOptions {
  delayMs?: number;
  disabled?: boolean;
}

const DEFAULT_PREFETCH_TTL_MS = 30_000;
const DEFAULT_PREFETCH_DELAY_MS = 120;
const MAX_CONCURRENT_PREFETCHES = 2;

let activePrefetches = 0;
const prefetchedAt = new Map<string, number>();
const inFlightPrefetchKeys = new Set<string>();

export async function prefetchSWRKey<T>(key: string, options: PrefetchOptions = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_PREFETCH_TTL_MS;
  const now = Date.now();
  const lastPrefetchedAt = prefetchedAt.get(key);

  if (!options.force && lastPrefetchedAt && now - lastPrefetchedAt < ttlMs) {
    return false;
  }

  if (inFlightPrefetchKeys.has(key) || activePrefetches >= MAX_CONCURRENT_PREFETCHES) {
    return false;
  }

  activePrefetches += 1;
  prefetchedAt.set(key, now);
  inFlightPrefetchKeys.add(key);

  try {
    await mutate(key, fetcher<T>(key), {
      populateCache: true,
      revalidate: false,
    });

    return true;
  } catch {
    return false;
  } finally {
    activePrefetches -= 1;
    inFlightPrefetchKeys.delete(key);
  }
}

export function useIntentPrefetch(
  keys: string | readonly string[],
  options: IntentPrefetchOptions = {}
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // stable ref for keys — avoids array identity churn in callbacks
  const keysRef = useRef<readonly string[]>(
    Array.isArray(keys) ? (keys as readonly string[]) : [keys as string]
  );
  const delayMs = options.delayMs ?? DEFAULT_PREFETCH_DELAY_MS;
  const disabled = options.disabled ?? false;
  const force = options.force ?? false;
  const ttlMs = options.ttlMs;

  // keep keys ref in sync without adding array to callback deps
  const keysSignature = Array.isArray(keys)
    ? (keys as readonly string[]).join('\x00')
    : (keys as string);
  useEffect(() => {
    keysRef.current = Array.isArray(keys) ? (keys as readonly string[]) : [keys as string];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSignature]);

  const cancelPrefetch = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedulePrefetch = useCallback(() => {
    if (disabled) return;
    cancelPrefetch();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      for (const k of keysRef.current) {
        void prefetchSWRKey(k, { force, ttlMs });
      }
    }, delayMs);
  }, [cancelPrefetch, delayMs, disabled, force, ttlMs]);

  useEffect(() => cancelPrefetch, [cancelPrefetch]);

  return {
    schedulePrefetch,
    cancelPrefetch,
  };
}

/**
 * 获取监控数据的 hook
 * @param config - SWR 配置
 * @returns 监控数据、加载状态和错误信息
 */
export function useMonitorData(config?: SWRConfiguration) {
  const { pageId } = usePageConfig();

  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<MonitorResponse>(SWR_KEYS.MONITOR(pageId), fetcher, {
    ...DEFAULT_SWR_CONFIG,
    refreshInterval: 60000, // 每60秒刷新一次
    keepPreviousData: true, // 页面切换时保留旧数据，避免闪烁
    ...config,
  });

  return {
    monitorGroups: data?.monitorGroups || [],
    monitoringData: data?.data || { heartbeatList: {}, uptimeList: {} },
    isLoading,
    isError: !!error,
    error,
    revalidate,
  };
}

/**
 * 获取单个 monitor 数据
 * @param monitorId - 监控 ID
 * @param config - SWR 配置选项
 * @returns 特定监控的数据、加载状态和错误信息
 */
export function useMonitor(monitorId: number | string, config?: SWRConfiguration) {
  const numericId = typeof monitorId === 'string' ? Number.parseInt(monitorId, 10) : monitorId;
  const { pageId } = usePageConfig();

  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<MonitorResponse>(SWR_KEYS.MONITOR(pageId), fetcher, {
    ...DEFAULT_SWR_CONFIG,
    refreshInterval: 60000,
    ...config,
  });

  const monitor = data?.monitorGroups
    ?.flatMap(group => group.monitorList)
    .find(m => m.id === numericId);

  const monitoringData: MonitoringData = {
    heartbeatList: {
      [numericId]: data?.data?.heartbeatList[numericId] || [],
    },
    uptimeList: {
      [`${numericId}_24`]: data?.data?.uptimeList[`${numericId}_24`] || 0,
    },
  };

  return {
    monitor,
    monitoringData,
    isLoading,
    isError: !!error,
    error,
    revalidate,
  };
}

/**
 * 获取 SWR 全局配置
 * @param config - SWR 配置选项
 * @returns 全局配置数据、加载状态和错误信息
 */
export function useConfig(config?: SWRConfiguration) {
  const { pageId } = usePageConfig();

  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<ConfigResponse>(SWR_KEYS.CONFIG(pageId), fetcher, {
    ...DEFAULT_SWR_CONFIG,
    revalidateIfStale: false, // 除非明确要求，否则不重新验证陈旧数据
    keepPreviousData: true, // 页面切换时保留旧数据，避免闪烁
    ...config,
  });

  return {
    config: data,
    isLoading,
    isError: !!error,
    error,
    revalidate,
  };
}

/**
 * 获取维护计划数据的 hook
 * @param config - SWR 配置选项
 * @returns 维护计划数据、加载状态和错误信息
 */
export function useMaintenanceData(config?: SWRConfiguration) {
  const { pageId } = usePageConfig();

  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<ConfigResponse>(SWR_KEYS.CONFIG(pageId), fetcher, {
    ...DEFAULT_SWR_CONFIG,
    refreshInterval: 60000, // 每60秒刷新一次
    ...config,
  });

  return {
    maintenanceList: data?.maintenanceList || [],
    isLoading,
    isError: !!error,
    error,
    revalidate,
  };
}

/**
 * 数据刷新 hook
 * @param key - 需要重新验证的缓存键
 * @returns Promise，完成后数据会被更新
 */
export function revalidateData(pageId: string, key?: string) {
  if (key) {
    return mutate(key);
  }

  return Promise.all([mutate(SWR_KEYS.MONITOR(pageId)), mutate(SWR_KEYS.CONFIG(pageId))]);
}

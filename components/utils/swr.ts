'use client';

import { usePageConfig } from '@/components/context/PageConfigContext';
import type { GlobalConfig } from '@/types/config';
import type { MonitorResponse, MonitoringData } from '@/types/monitor';
import useSWR, { mutate } from 'swr';
import type { SWRConfiguration } from 'swr';

/**
 * swr 通用 fetcher
 * @param url - 请求的 URL
 * @returns 解析后的 JSON data
 * @throws 请求失败抛出错误
 */
const fetcher = async (url: string) => {
  const response = await fetch(url);
  const data = await response.json();

  if (!data.success && url.includes('/api/monitor')) {
    throw new Error('Failed to fetch monitor data');
  }

  return data;
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
  } = useSWR<GlobalConfig>(SWR_KEYS.CONFIG(pageId), fetcher, {
    ...DEFAULT_SWR_CONFIG,
    revalidateIfStale: false, // 除非明确要求，否则不重新验证陈旧数据
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
  } = useSWR<GlobalConfig>(SWR_KEYS.CONFIG(pageId), fetcher, {
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

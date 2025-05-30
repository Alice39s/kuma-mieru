import { getConfigForPage } from '@/config/api';
import type { GlobalConfig, Maintenance } from '@/types/config';
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
 * 获取特定页面的API URL
 * @param baseUrl - API基础URL
 * @param pageId - 页面ID
 * @returns 带有pageId参数的URL
 */
const getPageUrl = (baseUrl: string, pageId?: string) => {
  if (!pageId) return baseUrl;
  return `${baseUrl}?pageId=${pageId}`;
};

/**
 * SWR Cache Key
 */
export const SWR_KEYS = {
  MONITOR: '/api/monitor',
  CONFIG: '/api/config',
};

/**
 * 默认配置
 */
const DEFAULT_SWR_CONFIG: SWRConfiguration = {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 5000, // 防抖措施，五秒内重复请求强制缓存
  errorRetryCount: 3, // 错误重试次数
};

/**
 * 获取监控数据的 hook
 * @param pageId - 页面ID（可选）
 * @param config - SWR 配置
 * @returns 监控数据、加载状态和错误信息
 */
export function useMonitorData(pageId?: string, config?: SWRConfiguration) {
  const url = getPageUrl(SWR_KEYS.MONITOR, pageId);

  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<MonitorResponse>(url, fetcher, {
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
 * @param pageId - 页面ID（可选）
 * @param config - SWR 配置选项
 * @returns 特定监控的数据、加载状态和错误信息
 */
export function useMonitor(monitorId: number | string, pageId?: string, config?: SWRConfiguration) {
  const numericId = typeof monitorId === 'string' ? Number.parseInt(monitorId, 10) : monitorId;
  const url = getPageUrl(SWR_KEYS.MONITOR, pageId);

  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<MonitorResponse>(url, fetcher, {
    ...DEFAULT_SWR_CONFIG,
    refreshInterval: 60000,
    ...config,
  });

  const monitor = data?.monitorGroups
    ?.flatMap((group) => group.monitorList)
    .find((m) => m.id === numericId);

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
 * @param pageId - 页面ID（可选）
 * @param config - SWR 配置选项
 * @returns 全局配置数据、加载状态和错误信息
 */
export function useConfig(pageId?: string, config?: SWRConfiguration) {
  const url = getPageUrl(SWR_KEYS.CONFIG, pageId);

  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<GlobalConfig>(url, fetcher, {
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
 * @param pageId - 页面ID（可选）
 * @param config - SWR 配置选项
 * @returns 维护计划数据、加载状态和错误信息
 */
export function useMaintenanceData(pageId?: string, config?: SWRConfiguration) {
  const url = getPageUrl(SWR_KEYS.CONFIG, pageId);

  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<GlobalConfig>(url, fetcher, {
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
 * @param pageId - 页面ID（可选）
 * @returns Promise，完成后数据会被更新
 */
export function revalidateData(pageId?: string) {
  const monitorUrl = getPageUrl(SWR_KEYS.MONITOR, pageId);
  const configUrl = getPageUrl(SWR_KEYS.CONFIG, pageId);

  return Promise.all([mutate(monitorUrl), mutate(configUrl)]);
}

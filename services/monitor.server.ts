import { apiConfig } from '@/config/api';
import { getPreloadData } from '@/services/config.server';
import type { Config } from '@/types/config';
import type { HeartbeatData, MonitorGroup, MonitoringData, UptimeData } from '@/types/monitor';
import { customFetchOptions, ensureUTCTimezone } from './utils/common';
import { customFetch } from './utils/fetch';

/**
 * Process heartbeat data to ensure UTC timezone
 * @param data - Heartbeat data
 * @returns Heartbeat data with UTC timezone
 */
function processHeartbeatData(data: HeartbeatData): HeartbeatData {
  const processed: HeartbeatData = {};
  for (const [key, heartbeats] of Object.entries(data)) {
    processed[key] = heartbeats.map((hb) => ({
      ...hb,
      time: ensureUTCTimezone(hb.time),
    }));
  }
  return processed;
}

class MonitorDataError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MonitorDataError';
  }
}

export async function getMonitoringData(config?: Config): Promise<{
  monitorGroups: MonitorGroup[];
  data: MonitoringData;
}> {
  try {
    // 使用传入的配置或默认配置
    const currentConfig = config || apiConfig;

    // 使用共享的预加载数据获取函数
    const preloadData = await getPreloadData(currentConfig);

    // 验证监控组数据
    if (!Array.isArray(preloadData.publicGroupList)) {
      throw new MonitorDataError('Monitor group data must be an array');
    }

    // 获取监控数据
    const apiResponse = await customFetch(currentConfig.apiEndpoint, customFetchOptions);

    if (!apiResponse.ok) {
      throw new MonitorDataError(
        `API request failed: ${apiResponse.status} ${apiResponse.statusText}`,
      );
    }

    let monitoringData: MonitoringData;
    try {
      const rawData = (await apiResponse.json()) as {
        heartbeatList: HeartbeatData;
        uptimeList: UptimeData;
      };

      // 验证监控数据结构
      if (!rawData || typeof rawData !== 'object') {
        throw new MonitorDataError('Monitor data must be an object');
      }

      if (!('heartbeatList' in rawData) || !('uptimeList' in rawData)) {
        throw new MonitorDataError('Monitor data is missing required fields');
      }

      // 验证心跳列表和正常运行时间列表的数据类型
      if (typeof rawData.heartbeatList !== 'object' || typeof rawData.uptimeList !== 'object') {
        throw new MonitorDataError('Heartbeat list and uptime list must be objects');
      }

      monitoringData = {
        ...rawData,
        heartbeatList: processHeartbeatData(rawData.heartbeatList),
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new MonitorDataError('Monitor data JSON parsing failed', error);
      }
      throw new MonitorDataError('Monitor data parsing failed', error);
    }

    return {
      monitorGroups: preloadData.publicGroupList,
      data: monitoringData,
    };
  } catch (error) {
    console.error(
      'Failed to get monitoring data:',
      error instanceof MonitorDataError ? error.message : 'Unknown error',
      {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
                cause: error.cause,
              }
            : error,
        endpoint: config?.apiEndpoint || apiConfig.apiEndpoint,
      },
    );

    // 返回默认值
    return {
      monitorGroups: [],
      data: { heartbeatList: {}, uptimeList: {} },
    };
  }
}

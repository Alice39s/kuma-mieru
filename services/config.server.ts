import { apiConfig } from '@/config/api';
import type { Config, GlobalConfig, Maintenance } from '@/types/config';
import { ConfigError } from '@/utils/errors';
import { extractPreloadData } from '@/utils/json-processor';
import { sanitizeJsonString } from '@/utils/json-sanitizer';
import * as cheerio from 'cheerio';
import { cache } from 'react';
import { ApiDataError, logApiError } from './utils/api-service';
import { customFetchOptions, ensureUTCTimezone } from './utils/common';
import { customFetch } from './utils/fetch';

function processMaintenanceData(maintenanceList: Maintenance[]): Maintenance[] {
  return maintenanceList.map((maintenance) => {
    const processed = {
      ...maintenance,
    };

    if (maintenance.timeslotList && maintenance.timeslotList.length > 0) {
      processed.timeslotList = maintenance.timeslotList.map((slot) => ({
        startDate: ensureUTCTimezone(slot.startDate),
        endDate: ensureUTCTimezone(slot.endDate),
      }));
    }

    const now = Date.now();

    if (processed.timeslotList && processed.timeslotList.length > 0) {
      const { startDate, endDate } = processed.timeslotList[0];
      const startTime = new Date(startDate).getTime();
      const endTime = new Date(endDate).getTime();

      if (now >= startTime && now < endTime) {
        processed.status = 'under-maintenance';
      } else if (now < startTime) {
        processed.status = 'scheduled';
      } else if (now >= endTime) {
        processed.status = 'ended';
      }
    }

    return processed;
  });
}

/**
 * 获取维护计划数据
 * @param config - 可选的配置对象
 * @returns 处理后的维护计划数据
 */
export async function getMaintenanceData(config?: Config) {
  try {
    const currentConfig = config || apiConfig;
    const preloadData = await getPreloadData(currentConfig);

    if (!Array.isArray(preloadData.maintenanceList)) {
      throw new ApiDataError('Maintenance list data must be an array');
    }

    const maintenanceList = preloadData.maintenanceList;
    const processedList = processMaintenanceData(maintenanceList);

    return {
      success: true,
      maintenanceList: processedList,
    };
  } catch (error) {
    const currentConfig = config || apiConfig;
    logApiError('get maintenance data', error, {
      endpoint: `${currentConfig.apiEndpoint}/maintenance`,
    });

    return {
      success: false,
      maintenanceList: [],
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export const getGlobalConfig = cache(async (config?: Config): Promise<GlobalConfig> => {
  try {
    const currentConfig = config || apiConfig;
    const preloadData = await getPreloadData(currentConfig);

    if (!preloadData.config) {
      throw new ConfigError('Configuration data is missing');
    }

    const requiredFields = ['slug', 'title', 'description', 'icon', 'theme'];

    for (const field of requiredFields) {
      if (!(field in preloadData.config)) {
        throw new ConfigError(`Configuration is missing required field: ${field}`);
      }
    }

    if (typeof preloadData.config.theme !== 'string') {
      throw new ConfigError('Theme must be a string');
    }

    const theme =
      preloadData.config.theme === 'dark'
        ? 'dark'
        : preloadData.config.theme === 'light'
          ? 'light'
          : 'system';

    const maintenanceData = await getMaintenanceData(currentConfig);
    const maintenanceList = maintenanceData.maintenanceList || [];

    const globalConfig: GlobalConfig = {
      config: {
        ...preloadData.config,
        theme,
      },
      incident: preloadData.incident
        ? {
            ...preloadData.incident,
            createdDate: ensureUTCTimezone(preloadData.incident.createdDate),
            lastUpdatedDate: ensureUTCTimezone(preloadData.incident.lastUpdatedDate),
          }
        : undefined,
      maintenanceList: maintenanceList,
    };

    return globalConfig;
  } catch (error) {
    console.error(
      'Failed to get configuration data:',
      error instanceof ConfigError ? error.message : 'Unknown error',
      error,
    );

    return {
      config: {
        slug: '',
        title: '',
        description: '',
        icon: '/icon.svg',
        theme: 'system',
        published: true,
        showTags: true,
        customCSS: '',
        footerText: '',
        showPoweredBy: false,
        googleAnalyticsId: null,
        showCertificateExpiry: false,
      },
      maintenanceList: [],
    };
  }
});

export async function getPreloadData(config?: Config) {
  const currentConfig = config || apiConfig;

  try {
    const htmlResponse = await customFetch(currentConfig.htmlEndpoint, customFetchOptions);

    if (!htmlResponse.ok) {
      throw new ConfigError(
        `Failed to get HTML: ${htmlResponse.status} ${htmlResponse.statusText}`,
      );
    }

    const html = await htmlResponse.text();
    const $ = cheerio.load(html);
    const preloadScript = $('#preload-data').text();

    if (!preloadScript) {
      throw new ConfigError('Preload script tag not found');
    }

    try {
      const jsonStr = sanitizeJsonString(preloadScript);
      return extractPreloadData(jsonStr);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ConfigError(
          `JSON parsing failed: ${error.message}\nProcessed data: ${preloadScript.slice(0, 100)}...`,
          error,
        );
      }
      if (error instanceof ConfigError) {
        throw error;
      }
      throw new ConfigError(
        `Failed to parse preload data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error,
      );
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    console.error('Failed to get preload data:', {
      endpoint: currentConfig.htmlEndpoint,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
              cause: error.cause,
            }
          : error,
    });
    throw new ConfigError(
      'Failed to get preload data, please check network connection and server status',
    );
  }
}

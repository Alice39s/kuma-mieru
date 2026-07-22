import 'server-only';

import { getConfig } from '@/config/api';
import type { Config, GlobalConfig, Maintenance } from '@/types/config';
import type { PageTabMeta, PageTabsStatusMatrix } from '@/types/page';
import { ConfigError, getErrorLogDetails, getErrorMessage } from '@/utils/errors';
import { buildIconProxyUrl } from '@/utils/icon-proxy';
import { resolvePreloadDataFromHtml } from '@/utils/preload-data';
import {
  parseGlobalConfigData,
  parseMaintenanceList,
  parseSiteConfig,
} from '@/utils/preload-data-schema';
import { cache } from 'react';
import { logApiError } from './utils/api-service';
import { customFetchOptions, ensureUTCTimezone } from './utils/common';
import { customFetch } from './utils/fetch';
import { classifyRequestError, extractHttpStatusDetails } from './utils/request-error';

export interface GlobalConfigResult {
  success: boolean;
  status: 'ok' | 'all_failed';
  data: GlobalConfig;
  failureType?: PageTabMeta['failureType'];
  error?: string;
}

export interface PageTabsMetadataResult {
  tabs: PageTabMeta[];
  matrix: PageTabsStatusMatrix;
}

function resolvePageConfig(pageId?: string): Config {
  const config = getConfig(pageId);

  if (!config) {
    throw new ConfigError(`Invalid status page id: ${pageId ?? 'undefined'}`);
  }

  return config;
}

function buildFallbackGlobalConfig(config: Config): GlobalConfig {
  return {
    config: {
      slug: '',
      title: '',
      description: '',
      icon: buildIconProxyUrl(config.pageId),
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

function processMaintenanceData(maintenanceList: Maintenance[]): Maintenance[] {
  return maintenanceList.map(maintenance => {
    const processed = {
      ...maintenance,
    };

    if (maintenance.timeslotList && maintenance.timeslotList.length > 0) {
      processed.timeslotList = maintenance.timeslotList.map(slot => ({
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
 * @returns 处理后的维护计划数据
 */
export async function getMaintenanceData(pageId?: string) {
  const config = resolvePageConfig(pageId);

  try {
    const preloadData = await getPreloadData(config);
    const maintenanceList = parseMaintenanceList(preloadData.maintenanceList);
    const processedList = processMaintenanceData(maintenanceList);

    return {
      success: true,
      maintenanceList: processedList,
    };
  } catch (error) {
    logApiError('get maintenance data', error, {
      endpoint: `${config.apiEndpoint}/maintenance`,
    });

    return {
      success: false,
      maintenanceList: [],
      failureType: classifyRequestError(error),
      error: getErrorMessage(error, 'Unknown error occurred'),
    };
  }
}

export const getPageTabsMetadataResult = cache(async (): Promise<PageTabsMetadataResult> => {
  const baseConfig = getConfig();

  if (!baseConfig) {
    return {
      tabs: [],
      matrix: {
        status: 'all_failed',
        failedPageIds: [],
      },
    };
  }

  const uniquePageIds = Array.from(new Set(baseConfig.pageIds));

  const tabs = await Promise.all(
    uniquePageIds.map(async pageId => {
      const pageConfig = getConfig(pageId);

      if (!pageConfig) {
        return null;
      }

      try {
        const preloadData = await getPreloadData(pageConfig);
        const meta = parseSiteConfig(preloadData.config);

        const title = meta.title.trim() || pageConfig.siteMeta.title?.trim() || pageId;

        const description = meta.description.trim() || pageConfig.siteMeta.description?.trim();

        return {
          id: pageId,
          title,
          description,
          icon: buildIconProxyUrl(pageId),
          health: 'healthy',
        } satisfies PageTabMeta;
      } catch (error) {
        console.error('Failed to resolve metadata for status page tab', {
          pageId,
          error,
        });

        const statusDetails = extractHttpStatusDetails(error);

        const fallbackTitle = pageConfig.siteMeta.title?.trim();
        const fallbackDescription = pageConfig.siteMeta.description?.trim();

        return {
          id: pageId,
          title: fallbackTitle && fallbackTitle.length > 0 ? fallbackTitle : pageId,
          description:
            fallbackDescription && fallbackDescription.length > 0 ? fallbackDescription : undefined,
          icon: buildIconProxyUrl(pageId),
          health: 'unavailable',
          failureType: classifyRequestError(error),
          failureMessage: getErrorMessage(error),
          failureStatusCode: statusDetails.statusCode,
          failureStatusMessage: statusDetails.statusMessage,
        } satisfies PageTabMeta;
      }
    })
  );

  const resolvedTabs = tabs.filter(tab => tab !== null) as PageTabMeta[];
  const failedPageIds = resolvedTabs.filter(tab => tab.health === 'unavailable').map(tab => tab.id);

  const matrix: PageTabsStatusMatrix =
    resolvedTabs.length > 0 && failedPageIds.length === resolvedTabs.length
      ? {
          status: 'all_failed',
          failedPageIds,
        }
      : failedPageIds.length > 0
        ? {
            status: 'partial_failed',
            failedPageIds,
          }
        : {
            status: 'ok',
            failedPageIds: [],
          };

  return {
    tabs: resolvedTabs,
    matrix,
  };
});

export const getPageTabsMetadata = cache(async (): Promise<PageTabMeta[]> => {
  const result = await getPageTabsMetadataResult();
  return result.tabs;
});

export const getGlobalConfigResult = cache(async (pageId?: string): Promise<GlobalConfigResult> => {
  const config = resolvePageConfig(pageId);

  try {
    const preloadData = await getPreloadData(config);
    const parsed = parseGlobalConfigData(preloadData);
    const maintenanceList = processMaintenanceData(parsed.maintenanceList);

    const result: GlobalConfig = {
      config: {
        ...parsed.config,
        icon: buildIconProxyUrl(config.pageId),
      },
      incidents: parsed.incidents,
      maintenanceList,
    };

    return {
      success: true,
      status: 'ok',
      data: result,
    };
  } catch (error) {
    console.error(
      'Failed to get configuration data:',
      error instanceof ConfigError ? error.message : 'Unknown error',
      {
        error,
        endpoint: config.htmlEndpoint,
      }
    );

    return {
      success: false,
      status: 'all_failed',
      data: buildFallbackGlobalConfig(config),
      failureType: classifyRequestError(error),
      error: getErrorMessage(error),
    };
  }
});

export const getGlobalConfig = cache(async (pageId?: string): Promise<GlobalConfig> => {
  const result = await getGlobalConfigResult(pageId);
  return result.data;
});

export const getUpstreamIconUrl = cache(async (config: Config): Promise<string | null> => {
  try {
    const preloadData = await getPreloadData(config);
    const { icon } = parseSiteConfig(preloadData.config);

    return icon.trim() || null;
  } catch {
    return null;
  }
});

export async function getPreloadData(config: Config) {
  try {
    const htmlResponse = await customFetch(config.htmlEndpoint, customFetchOptions);

    if (!htmlResponse.ok) {
      throw new ConfigError(
        `Failed to get HTML: ${htmlResponse.status} ${htmlResponse.statusText}`
      );
    }

    const html = await htmlResponse.text();
    const resolved = await resolvePreloadDataFromHtml({
      html,
      baseUrl: config.baseUrl,
      pageId: config.pageId,
      fetchFn: (url, init) =>
        customFetch(
          url,
          init as RequestInit & { maxRetries?: number; retryDelay?: number; timeout?: number }
        ),
      requestInit: customFetchOptions,
      logger: console,
      includeHtmlDiagnostics: true,
    });

    return resolved.data;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    console.error('Failed to get preload data:', {
      endpoint: config.htmlEndpoint,
      error: getErrorLogDetails(error),
    });
    throw new ConfigError(
      'Failed to get preload data, please check network connection and server status',
      error
    );
  }
}

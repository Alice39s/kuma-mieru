import { getConfig } from '@/config/api';
import type { Config, GlobalConfig, Maintenance } from '@/types/config';
import type { PageTabMeta, PageTabsStatusMatrix } from '@/types/page';
import { ConfigError } from '@/utils/errors';
import { buildIconProxyUrl } from '@/utils/icon-proxy';
import { resolvePreloadDataFromHtml } from '@/utils/preload-data';
import { cache } from 'react';
import { ApiDataError, logApiError } from './utils/api-service';
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
    logApiError('get maintenance data', error, {
      endpoint: `${config.apiEndpoint}/maintenance`,
    });

    return {
      success: false,
      maintenanceList: [],
      failureType: classifyRequestError(error),
      error: error instanceof Error ? error.message : 'Unknown error occurred',
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
        const meta = preloadData.config ?? {};

        const title =
          typeof meta.title === 'string' && meta.title.trim().length > 0
            ? meta.title.trim()
            : pageConfig.siteMeta.title?.trim() || pageId;

        const description =
          typeof meta.description === 'string' && meta.description.trim().length > 0
            ? meta.description.trim()
            : pageConfig.siteMeta.description?.trim();

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
          failureMessage: error instanceof Error ? error.message : 'Unknown error',
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

    const maintenanceList = Array.isArray(preloadData.maintenanceList)
      ? processMaintenanceData(preloadData.maintenanceList)
      : [];

    const rawIncidents = Array.isArray(preloadData.incidents)
      ? preloadData.incidents
      : preloadData.incident
        ? [preloadData.incident]
        : [];

    // `active` is omitted by legacy Kuma (single-incident shape) — treat missing as active
    // so back-compat consumers keep seeing the incident. Newer Kuma sends an explicit boolean.
    // `createdDate` is required: without it the UI would render the Unix epoch (1970) rather
    // than a meaningful timestamp, so drop malformed entries at the boundary.
    const incidents = rawIncidents
      .filter(incident => incident && incident.active !== false && incident.createdDate)
      .map(incident => ({
        ...incident,
        pin: Boolean(incident.pin),
        createdDate: ensureUTCTimezone(incident.createdDate),
        lastUpdatedDate: incident.lastUpdatedDate
          ? ensureUTCTimezone(incident.lastUpdatedDate)
          : null,
      }));

    const result: GlobalConfig = {
      config: {
        ...preloadData.config,
        icon: buildIconProxyUrl(config.pageId),
        theme,
      },
      incidents: incidents.length > 0 ? incidents : undefined,
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
      error: error instanceof Error ? error.message : 'Unknown error',
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
    const icon = preloadData.config?.icon;

    return typeof icon === 'string' && icon.trim().length > 0 ? icon.trim() : null;
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
      error
    );
  }
}

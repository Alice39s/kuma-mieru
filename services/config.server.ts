import { getConfig } from '@/config/api';
import type { Config, GlobalConfig, Maintenance } from '@/types/config';
import type { PageTabMeta } from '@/types/page';
import { ConfigError } from '@/utils/errors';
import { extractPreloadData } from '@/utils/json-processor';
import { sanitizeJsonString } from '@/utils/json-sanitizer';
import { fetchPreloadDataFromApi, getPreloadPayload } from '@/utils/preload-data';
import * as cheerio from 'cheerio';
import { cache } from 'react';
import { ApiDataError, logApiError } from './utils/api-service';
import { customFetchOptions, ensureUTCTimezone } from './utils/common';
import { customFetch } from './utils/fetch';

function resolvePageConfig(pageId?: string): Config {
  const config = getConfig(pageId);

  if (!config) {
    throw new ConfigError(`Invalid status page id: ${pageId ?? 'undefined'}`);
  }

  return config;
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
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export const getPageTabsMetadata = cache(async (): Promise<PageTabMeta[]> => {
  const baseConfig = getConfig();

  if (!baseConfig) {
    return [];
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

        const icon =
          typeof meta.icon === 'string' && meta.icon.trim().length > 0
            ? meta.icon.trim()
            : pageConfig.siteMeta.icon;

        return {
          id: pageId,
          title,
          description,
          icon,
        } satisfies PageTabMeta;
      } catch (error) {
        console.error('Failed to resolve metadata for status page tab', {
          pageId,
          error,
        });

        const fallbackTitle = pageConfig.siteMeta.title?.trim();
        const fallbackDescription = pageConfig.siteMeta.description?.trim();

        return {
          id: pageId,
          title: fallbackTitle && fallbackTitle.length > 0 ? fallbackTitle : pageId,
          description:
            fallbackDescription && fallbackDescription.length > 0 ? fallbackDescription : undefined,
          icon: pageConfig.siteMeta.icon,
        } satisfies PageTabMeta;
      }
    })
  );

  return tabs.filter(tab => tab !== null) as PageTabMeta[];
});

export const getGlobalConfig = cache(async (pageId?: string): Promise<GlobalConfig> => {
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

    const maintenanceData = await getMaintenanceData(config.pageId);
    const maintenanceList = maintenanceData.maintenanceList || [];

    const result: GlobalConfig = {
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

    return result;
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

export async function getPreloadData(config: Config) {
  try {
    const htmlResponse = await customFetch(config.htmlEndpoint, customFetchOptions);

    if (!htmlResponse.ok) {
      throw new ConfigError(
        `Failed to get HTML: ${htmlResponse.status} ${htmlResponse.statusText}`
      );
    }

    const html = await htmlResponse.text();
    const $ = cheerio.load(html);

    // Uptime Kuma version > 1.18.4, use script#preload-data to get preload data
    // @see https://github.com/louislam/uptime-kuma/commit/6e07ed20816969bfd1c6c06eb518171938312782
    // & https://github.com/louislam/uptime-kuma/issues/2186#issuecomment-1270471470
    const { payload: initialPayload, source } = getPreloadPayload($);
    let preloadScript = initialPayload ?? '';

    if (source === 'data-json') {
      console.debug('Using preload data from data-json attribute');
    }

    if (!preloadScript || preloadScript.trim() === '') {
      // Uptime Kuma version <= 1.18.4, use script:contains("window.preloadData") to get preload data
      const scriptWithPreloadData = $('script:contains("window.preloadData")').text();

      if (scriptWithPreloadData) {
        const match = scriptWithPreloadData.match(/window\.preloadData\s*=\s*({[\s\S]*?});/);
        if (match && match[1]) {
          preloadScript = match[1];
          console.log('Successfully extracted preload data from window.preloadData');
        } else {
          console.error(
            'Failed to extract preload data with regex. Script content:',
            scriptWithPreloadData.slice(0, 200)
          );
        }
      }
    }

    if (!preloadScript || preloadScript.trim() === '') {
      console.warn('Preload script missing, attempting status page API fallback');
      try {
        const apiFallback = await fetchPreloadDataFromApi({
          baseUrl: config.baseUrl,
          pageId: config.pageId,
          fetchFn: (url, init) =>
            customFetch(
              url,
              init as RequestInit & { maxRetries?: number; retryDelay?: number; timeout?: number }
            ),
          requestInit: customFetchOptions,
        });
        console.info('Using status page API fallback for preload data');
        return apiFallback.data;
      } catch (apiError) {
        console.error('Status page API fallback failed:', apiError);
      }
    }

    if (!preloadScript || preloadScript.trim() === '') {
      console.error('HTML response preview:', html.slice(0, 500));
      console.error(
        'Available script tags:',
        $('script')
          .map((i, el) => $(el).attr('id') || 'no-id')
          .get()
      );
      throw new ConfigError('Preload script tag not found or empty');
    }

    try {
      const jsonStr = sanitizeJsonString(preloadScript);
      return extractPreloadData(jsonStr);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ConfigError(
          `JSON parsing failed: ${error.message}\nProcessed data: ${preloadScript.slice(0, 100)}...`,
          error
        );
      }
      if (error instanceof ConfigError) {
        throw error;
      }
      throw new ConfigError(
        `Failed to parse preload data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
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
      'Failed to get preload data, please check network connection and server status'
    );
  }
}

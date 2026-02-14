import type { Config } from '@/types/config';
import { env } from './env';

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export const getConfig = (pageId?: string): Config | null => {
  const {
    baseUrl,
    pageId: defaultPageId,
    pageIds,
    pages,
    siteMeta,
    isEditThisPage,
    isShowStarButton,
  } = env.config;
  const { NODE_ENV } = env.runtime;

  if (!baseUrl || !defaultPageId || pageIds.length === 0) {
    throw new Error('Missing required configuration variables');
  }

  const resolvedPageId =
    pageId === undefined ? defaultPageId : pageIds.includes(pageId) ? pageId : null;

  if (!resolvedPageId) {
    return null;
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const resolvedSiteMeta = pages.find(page => page.id === resolvedPageId)?.siteMeta ?? siteMeta;

  const config: Config = {
    baseUrl,
    defaultPageId,
    pageId: resolvedPageId,
    pageIds,
    pages,
    siteMeta: resolvedSiteMeta,
    isPlaceholder: env.config.isPlaceholder,
    isEditThisPage: isEditThisPage ?? false,
    isShowStarButton: isShowStarButton ?? true,
    htmlEndpoint: `${normalizedBaseUrl}/status/${resolvedPageId}`,
    apiEndpoint: `${normalizedBaseUrl}/api/status-page/heartbeat/${resolvedPageId}`,
  };

  if (NODE_ENV === 'development') {
    console.log('config', config);
  }

  return config;
};

export const apiConfig = (() => {
  const config = getConfig();
  if (!config) {
    throw new Error('Failed to resolve default status page configuration');
  }
  return config;
})();

export type ApiConfig = Config;

export const getAvailablePageIds = () => [...env.config.pageIds];

export const validateConfig = () => {
  return true;
};

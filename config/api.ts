import type { Config } from '@/types/config';
import { env } from './env';
import type { PageConfig } from './types';

export const getConfig = (): Config => {
  const { baseUrl, defaultPageId, pages, isEditThisPage, isShowStarButton } = env.config;
  const { NODE_ENV } = env.runtime;

  if (!baseUrl || !defaultPageId || !pages || pages.length === 0) {
    throw new Error('Missing required configuration variables');
  }

  // 获取默认页面的配置
  const defaultPage = pages.find((page: PageConfig) => page.id === defaultPageId) || pages[0];

  const config: Config = {
    baseUrl,
    defaultPageId,
    pages,
    currentPageId: defaultPageId, // 默认使用defaultPageId
    htmlEndpoint: `${baseUrl}/status/${defaultPageId}`,
    apiEndpoint: `${baseUrl}/api/status-page/heartbeat/${defaultPageId}`,
    siteMeta: defaultPage.siteMeta,
    isPlaceholder: false,
    isEditThisPage: isEditThisPage || false,
    isShowStarButton: isShowStarButton || true,
  };

  if (NODE_ENV === 'development') {
    console.log('config', config);
  }

  return config;
};

export const apiConfig = getConfig();

export type ApiConfig = Config;

export const validateConfig = () => {
  return true;
};

// 根据页面ID获取配置
export const getConfigForPage = (pageId: string): Config => {
  const config = { ...apiConfig };

  // 查找对应页面
  const page = config.pages.find((p: PageConfig) => p.id === pageId);
  if (page) {
    config.currentPageId = pageId;
    config.htmlEndpoint = `${config.baseUrl}/status/${pageId}`;
    config.apiEndpoint = `${config.baseUrl}/api/status-page/heartbeat/${pageId}`;
    config.siteMeta = page.siteMeta;
  }

  return config;
};

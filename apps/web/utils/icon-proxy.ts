export const buildIconProxyUrl = (pageId?: string): string => {
  if (!pageId) {
    return '/api/icon';
  }

  return `/api/icon?pageId=${encodeURIComponent(pageId)}`;
};

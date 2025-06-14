export function resolveIconUrl(iconPath?: string, baseUrl?: string): string {
  const defaultIcon = '/icon.svg';

  if (!iconPath) return defaultIcon;

  if (iconPath.startsWith('http')) {
    return iconPath;
  }

  if (!baseUrl) {
    return iconPath.startsWith('/') ? iconPath : `/${iconPath}`;
  }

  return `${baseUrl}/${iconPath.replace(/^\//, '')}`;
}

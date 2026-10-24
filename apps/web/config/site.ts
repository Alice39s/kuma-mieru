import { DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_ICON, DEFAULT_SITE_TITLE } from './defaults';
import { env } from './env';
import { buildIconProxyUrl } from '@/utils/icon-proxy';

const baseConfig = {
  name: DEFAULT_SITE_TITLE,
  description: DEFAULT_SITE_DESCRIPTION,
  icon: DEFAULT_SITE_ICON,
} as const;

interface NavItem {
  label: string;
  href: string;
  external: boolean;
}

const navItems: NavItem[] = [
  {
    label: 'page.main',
    href: '/',
    external: false,
  },
  {
    label: 'page.edit',
    href: `/api/manage-status-page?pageId=${encodeURIComponent(env.config.pageId)}`,
    external: true,
  },
];

export const resolveIconUrl = (pageId?: string): string => {
  return buildIconProxyUrl(pageId ?? env.config.pageId);
};

export const resolveIconCandidates = (pageIds: string[]): string[] => {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const pageId of pageIds) {
    const resolved = resolveIconUrl(pageId);
    if (!seen.has(resolved)) {
      deduped.push(resolved);
      seen.add(resolved);
    }
  }

  if (deduped.length === 0) {
    deduped.push(baseConfig.icon);
  }

  return deduped;
};

const getVisibleNavItems = (items: NavItem[]): NavItem[] => {
  return items.filter(item => (item.label !== 'page.edit' ? true : env.config.isEditThisPage));
};

const iconCandidates = resolveIconCandidates(env.config.pageIds);

export const siteConfig = {
  name: env.config.siteMeta.title || baseConfig.name,
  description: env.config.siteMeta.description || baseConfig.description,
  icon: iconCandidates[0],
  iconCandidates,
  navItems: getVisibleNavItems(navItems),
  navMenuItems: getVisibleNavItems(navItems),
  links: {
    github: 'https://github.com/Alice39s/kuma-mieru',
    docs: 'https://github.com/Alice39s/kuma-mieru/blob/main/README.md',
  },
} as const;

export type SiteConfig = typeof siteConfig;

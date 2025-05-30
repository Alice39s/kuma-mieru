'use client';

import { resolveIconUrl } from '@/utils/url';
import { getConfigForPage } from './api';
import { env } from './env';

const baseConfig = {
  name: 'Kuma Mieru',
  description: 'A beautiful and modern uptime monitoring dashboard',
  icon: '/icon.svg',
} as const;

interface NavItem {
  label: string;
  href: string;
  external: boolean;
}

const navItems: NavItem[] = [
  // {
  //   label: 'page.main',
  //   href: '/',
  //   external: false,
  // },
  {
    label: 'page.edit',
    href: `${env.config.baseUrl}/manage-status-page`,
    external: true,
  },
];

const getVisibleNavItems = (items: NavItem[]): NavItem[] => {
  return items.filter((item) => (item.label !== 'page.edit' ? true : env.config.isEditThisPage));
};

const defaultPage =
  env.config.pages.find((page) => page.id === env.config.defaultPageId) || env.config.pages[0];

const siteMeta = defaultPage?.siteMeta || {
  title: baseConfig.name,
  description: baseConfig.description,
  icon: baseConfig.icon,
};

export const siteConfig = {
  name: siteMeta.title || baseConfig.name,
  description: siteMeta.description || baseConfig.description,
  icon: resolveIconUrl(siteMeta.icon, env.config.baseUrl),
  navItems: getVisibleNavItems(navItems),
  navMenuItems: getVisibleNavItems(navItems),
  links: {
    github: 'https://github.com/Alice39s/kuma-mieru',
    docs: 'https://github.com/Alice39s/kuma-mieru/blob/main/README.md',
  },
} as const;

export type SiteConfig = typeof siteConfig;

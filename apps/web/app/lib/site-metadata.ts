import { DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_ICON, DEFAULT_SITE_TITLE } from '@/config/defaults';
import type { Config } from '@/types/config';
import { buildIconProxyUrl } from '@/utils/icon-proxy';
import type { Metadata } from 'next';
import packageJson from '@/package.json';

const BASE_METADATA: Pick<Metadata, 'generator' | 'formatDetection'> = {
  generator: `https://github.com/Alice39s/kuma-mieru v${packageJson.version}`,
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const buildDefaultMetadata = (): Metadata => ({
  title: {
    default: DEFAULT_SITE_TITLE,
    template: `%s - ${DEFAULT_SITE_TITLE}`,
  },
  description: DEFAULT_SITE_DESCRIPTION,
  icons: {
    icon: [DEFAULT_SITE_ICON],
  },
  ...BASE_METADATA,
});

export const buildStatusPageMetadata = (config?: Config | null): Metadata => {
  const resolvedTitle = config?.siteMeta.title?.trim() || DEFAULT_SITE_TITLE;
  const resolvedDescription = config?.siteMeta.description?.trim() || DEFAULT_SITE_DESCRIPTION;
  const resolvedIcon = config ? buildIconProxyUrl(config.pageId) : DEFAULT_SITE_ICON;

  return {
    title: resolvedTitle,
    description: resolvedDescription,
    icons: {
      icon: [resolvedIcon],
    },
    ...BASE_METADATA,
  };
};

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

interface MetadataOptions {
  monitorId?: string;
  monitorName?: string;
  isAbout?: boolean;
}

export const buildStatusPageMetadata = (
  config?: Pick<Config, 'pageId' | 'siteMeta'> | null,
  options: MetadataOptions = {}
): Metadata => {
  const resolvedTitle = config?.siteMeta.title?.trim() || DEFAULT_SITE_TITLE;
  const resolvedDescription = config?.siteMeta.description?.trim() || DEFAULT_SITE_DESCRIPTION;
  const resolvedIcon = config ? buildIconProxyUrl(config.pageId) : DEFAULT_SITE_ICON;
  const shareTitle = options.isAbout
    ? `About ${DEFAULT_SITE_TITLE}`
    : options.monitorName || resolvedTitle;
  const params = new URLSearchParams();
  if (config?.pageId) params.set('pageId', config.pageId);
  if (options.monitorId) params.set('monitorId', options.monitorId);
  if (options.isAbout) params.set('view', 'about');
  const image = {
    url: `/og${params.size ? `?${params}` : ''}`,
    width: 1200,
    height: 630,
    alt: options.monitorName ? `${options.monitorName} - ${resolvedTitle}` : shareTitle,
    type: 'image/png',
  };

  return {
    title: resolvedTitle,
    description: resolvedDescription,
    openGraph: {
      type: 'website',
      title: shareTitle,
      description: resolvedDescription,
      siteName: DEFAULT_SITE_TITLE,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: shareTitle,
      description: resolvedDescription,
      images: [image],
    },
    icons: {
      icon: [resolvedIcon],
    },
    ...BASE_METADATA,
  };
};

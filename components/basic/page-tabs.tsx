'use client';

import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import NextLink from 'next/link';

import { usePageConfig } from '@/components/context/PageConfigContext';
import { resolveIconUrl } from '@/config/site';
import type { PageTabMeta } from '@/types/page';

interface PageTabsProps {
  tabs?: PageTabMeta[];
}

export function PageTabs({ tabs: providedTabs }: PageTabsProps) {
  const pageConfig = usePageConfig();
  const t = useTranslations('navbar');

  if (!Array.isArray(pageConfig.pageIds) || pageConfig.pageIds.length <= 1) {
    return null;
  }

  const providedMeta = new Map(providedTabs?.map(tab => [tab.id, tab]));

  const resolvedTabs = pageConfig.pageIds.map(id => {
    const metaFromPreload = providedMeta.get(id);
    const fallbackSiteMeta = pageConfig.pages.find(page => page.id === id)?.siteMeta;

    const title = metaFromPreload?.title?.trim() || fallbackSiteMeta?.title?.trim() || id;
    const description =
      metaFromPreload?.description?.trim() || fallbackSiteMeta?.description?.trim();
    const icon = resolveIconUrl(metaFromPreload?.icon || fallbackSiteMeta?.icon);

    const href = id === pageConfig.defaultPageId ? '/' : `/${id}`;
    const isActive = pageConfig.pageId === id;

    return {
      id,
      title,
      description,
      icon,
      href,
      isActive,
    };
  });

  return (
    <nav
      aria-label={t('pageTabs')}
      className="border-b border-default-100 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <ul className="container mx-auto max-w-7xl px-6 flex gap-2 md:gap-3 overflow-x-auto py-3">
        {resolvedTabs.map(({ id, title, description, icon, href, isActive }) => (
          <li key={id} className="flex-shrink-0">
            <NextLink
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={clsx(
                'group inline-flex items-center gap-3 min-w-[176px] rounded-2xl border px-4 py-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary',
                isActive
                  ? 'border-primary/60 bg-primary/10 text-primary shadow-md'
                  : 'border-default-200 text-default-500 hover:border-primary/40 hover:text-primary hover:bg-default-100/70'
              )}
            >
              <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-default-200 bg-default-100">
                <Image src={icon} alt={title} width={28} height={28} />
              </span>
              <span className="flex min-w-0 flex-col text-left">
                <span className="truncate font-medium text-sm" title={title}>
                  {title}
                </span>
                {description ? (
                  <span className="truncate text-xs text-default-400" title={description}>
                    {description}
                  </span>
                ) : null}
              </span>
            </NextLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

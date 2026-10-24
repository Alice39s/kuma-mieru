'use client';

import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import { usePageConfig } from '@/components/context/PageConfigContext';
import { SWR_KEYS, useIntentPrefetch } from '@/components/utils/swr';
import type { PageHealthStatus, PageTabMeta } from '@/types/page';
import { buildIconProxyUrl } from '@/utils/icon-proxy';

interface PageTabsProps {
  tabs?: PageTabMeta[];
}

interface ResolvedPageTab {
  id: string;
  title: string;
  description?: string;
  icon: string;
  health: PageHealthStatus;
  href: string;
  isActive: boolean;
}

const HEALTH_DOT: Record<PageHealthStatus, string> = {
  healthy: 'bg-success',
  unavailable: 'bg-danger animate-pulse',
};

function PageTabItem({ tab }: { tab: ResolvedPageTab }) {
  const router = useRouter();

  const prefetchKeys = useMemo(
    () => [SWR_KEYS.MONITOR(tab.id), SWR_KEYS.CONFIG(tab.id)] as const,
    [tab.id]
  );

  const { schedulePrefetch, cancelPrefetch } = useIntentPrefetch(prefetchKeys, {
    disabled: tab.isActive,
  });

  const handlePointerEnter = useCallback(() => {
    if (!tab.isActive) {
      router.prefetch(tab.href);
    }
    schedulePrefetch();
  }, [tab.isActive, tab.href, router, schedulePrefetch]);

  return (
    <li className="shrink-0">
      <NextLink
        href={tab.href}
        aria-current={tab.isActive ? 'page' : undefined}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={cancelPrefetch}
        onFocus={schedulePrefetch}
        onBlur={cancelPrefetch}
        className={clsx(
          'group inline-flex items-center gap-3 min-w-44 rounded-2xl border px-4 py-3 text-sm shadow-sm',
          'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary',
          tab.health === 'unavailable' && 'border-danger/40 bg-danger/10 text-danger',
          tab.isActive
            ? 'border-primary/60 bg-primary/10 text-primary shadow-md scale-[1.01]'
            : 'border-default-200 text-default-500 hover:border-primary/40 hover:text-primary hover:bg-default-100/70 hover:scale-[1.01]'
        )}
      >
        <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-default-200 bg-default-100">
          <Image src={tab.icon} alt={tab.title} width={28} height={28} />
          {/* health dot */}
          <span
            aria-hidden="true"
            className={clsx(
              'absolute bottom-0 right-0 h-2 w-2 rounded-full ring-1 ring-background translate-x-0.5 translate-y-0.5',
              HEALTH_DOT[tab.health]
            )}
          />
        </span>
        <span className="flex min-w-0 flex-col text-left">
          <span className="truncate font-medium text-sm" title={tab.title}>
            {tab.title}
          </span>
          {tab.description ? (
            <span className="truncate text-xs text-default-400" title={tab.description}>
              {tab.description}
            </span>
          ) : null}
          {tab.health === 'unavailable' ? (
            <span className="truncate text-xs text-danger/80" title="Unavailable">
              Unavailable
            </span>
          ) : null}
        </span>
      </NextLink>
    </li>
  );
}

export function PageTabs({ tabs: providedTabs }: PageTabsProps) {
  const pageConfig = usePageConfig();
  const t = useTranslations('navbar');

  if (!Array.isArray(pageConfig.pageIds) || pageConfig.pageIds.length <= 1) {
    return null;
  }

  const providedMeta = new Map(providedTabs?.map(tab => [tab.id, tab]));

  const resolvedTabs = pageConfig.pageIds.map<ResolvedPageTab>(id => {
    const metaFromPreload = providedMeta.get(id);
    const fallbackSiteMeta = pageConfig.pages.find(page => page.id === id)?.siteMeta;

    const title = metaFromPreload?.title?.trim() || fallbackSiteMeta?.title?.trim() || id;
    const description =
      metaFromPreload?.description?.trim() || fallbackSiteMeta?.description?.trim();
    const icon = buildIconProxyUrl(id);
    const health = metaFromPreload?.health ?? 'healthy';

    const href = id === pageConfig.defaultPageId ? '/' : `/${id}`;
    const isActive = pageConfig.pageId === id;

    return {
      id,
      title,
      description,
      icon,
      health,
      href,
      isActive,
    };
  });

  return (
    <nav
      aria-label={t('pageTabs')}
      className="sticky top-0 z-40 border-b border-default-100 bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60"
    >
      <div className="relative container mx-auto max-w-7xl">
        <ul className="flex gap-2 md:gap-3 overflow-x-auto py-3 px-6 tab-scroll-list">
          {resolvedTabs.map(tab => (
            <PageTabItem key={tab.id} tab={tab} />
          ))}
        </ul>
        {/* right fade gradient when list overflows */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 inset-y-0 w-10 bg-gradient-to-l from-background/80 to-transparent"
        />
      </div>
    </nav>
  );
}

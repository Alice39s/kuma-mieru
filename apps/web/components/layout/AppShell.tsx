'use client';

import { Footer } from '@/components/Footer';
import Analytics from '@/components/basic/google-analytics';
import { Navbar } from '@/components/basic/navbar';
import { PageTabs } from '@/components/basic/page-tabs';
import { usePageConfig } from '@/components/context/PageConfigContext';
import { useConfig } from '@/components/utils/swr';
import type { SiteConfig } from '@/types/config';
import type { PageTabMeta } from '@/types/page';
import { useTheme } from 'next-themes';
import { useEffect } from 'react';

interface AppShellProps {
  children: React.ReactNode;
  footerConfig?: SiteConfig;
  pageTabs?: PageTabMeta[];
}

export function AppShell({ children, footerConfig, pageTabs }: AppShellProps) {
  const { pageId } = usePageConfig();
  const { setTheme } = useTheme();
  const { config: liveConfig } = useConfig();
  const resolvedFooterConfig = liveConfig?.config ?? footerConfig;
  const resolvedPageTabs = liveConfig?.pageTabs ?? pageTabs;
  const failedTabs = (resolvedPageTabs ?? []).filter(tab => tab.health === 'unavailable');
  const hasPartialFailure =
    failedTabs.length > 0 && failedTabs.length < (resolvedPageTabs?.length ?? 0);

  useEffect(() => {
    if (!liveConfig?.config.theme || window.localStorage.getItem('theme')) {
      return;
    }

    setTheme(liveConfig.config.theme);
  }, [liveConfig?.config.theme, setTheme]);

  return (
    <div className="relative flex flex-col min-h-screen">
      {liveConfig?.config.googleAnalyticsId ? (
        <Analytics id={liveConfig.config.googleAnalyticsId} />
      ) : null}
      <Navbar />
      <PageTabs tabs={resolvedPageTabs} />
      {hasPartialFailure ? (
        <div className="container mx-auto max-w-7xl px-6 pt-4">
          <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning-700 dark:text-warning-400">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-warning animate-pulse" />
            <span>
              Some status pages are unavailable:{' '}
              <span className="font-medium">{failedTabs.map(tab => tab.id).join(', ')}</span>
            </span>
          </div>
        </div>
      ) : null}
      <main key={pageId} className="container mx-auto max-w-7xl pt-4 px-6 grow fade-in-soft">
        {children}
      </main>
      <Footer config={resolvedFooterConfig} />
    </div>
  );
}

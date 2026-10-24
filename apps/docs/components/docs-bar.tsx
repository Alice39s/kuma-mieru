'use client';

import { useI18n } from 'fumadocs-ui/contexts/i18n';
import { useDocsLayout } from 'fumadocs-ui/layouts/docs';
import { PanelLeft } from 'lucide-react';
import { iconButton } from './icon-button';
import { isLocale } from '@/lib/i18n';
import { siteText } from '@/lib/layout.shared';

/** The site header carries the brand, so the sidebar shows no title link of its own. */
export function NoSidebarTitle() {
  return null;
}

/**
 * Below 1024px, where the page tree becomes a drawer: a bar under the site header that opens it and the search. It
 * takes the place of Fumadocs' own small-screen header, so the layout's row offsets stay in step.
 */
export function DocsBar() {
  const { locale } = useI18n();
  const { slots } = useDocsLayout();
  if (locale === undefined || !isLocale(locale))
    throw new Error(`The docs bar renders outside a docs language: ${locale}`);
  const SidebarTrigger = slots.sidebar?.trigger;
  const SearchTrigger = slots.searchTrigger === false ? undefined : slots.searchTrigger?.sm;
  return (
    <div className="sticky top-(--fd-docs-row-1) z-30 flex h-(--fd-header-height) items-center justify-between border-b bg-fd-background px-2 [grid-area:header] sm:px-4 md:hidden max-md:layout:[--fd-header-height:--spacing(12)]">
      {SidebarTrigger && (
        <SidebarTrigger className={`${iconButton} w-auto px-2 text-sm hover:text-fd-foreground`}>
          <PanelLeft aria-hidden="true" />
          {siteText[locale].pages}
        </SidebarTrigger>
      )}
      {SearchTrigger && <SearchTrigger className={iconButton} />}
    </div>
  );
}

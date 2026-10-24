'use client';

import { Activity, GitBranch, Languages } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { iconButton } from './icon-button';
import { ThemeMenu } from './theme-menu';
import { i18n, type Locale } from '@/lib/i18n';
import { siteText } from '@/lib/layout.shared';
import { repositoryUrl, siteName } from '@/lib/shared';

/** The same page in the other language: the locale segment is replaced, the rest of the path kept. */
function switchLocalePath(pathname: string, target: Locale): string {
  const [, ...rest] = pathname.split('/').filter(segment => segment.length > 0);
  return `/${[target, ...rest].join('/')}`;
}

/** The site header (design.md「站点外壳」): brand on the left, repository, language and theme on the right. */
export function SiteHeader({ locale }: { locale: Locale }) {
  const text = siteText[locale];
  const pathname = usePathname();
  const other = i18n.languages.find(language => language !== locale) ?? i18n.defaultLanguage;

  return (
    <header className="sticky top-0 z-40 h-(--km-header-height) border-b bg-fd-background/70 backdrop-blur-lg backdrop-saturate-150">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* The visible words are the link's name; the spaces keep them apart when read out. */}
        <Link href={`/${locale}`} className="flex min-w-0 items-center gap-2 rounded-(--radius)">
          <Activity
            aria-hidden="true"
            className="size-6 shrink-0 text-success"
            strokeWidth={1.75}
          />
          <span className="truncate font-bold">{siteName}</span>{' '}
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-fd-border" />{' '}
          <span className="shrink-0 text-sm text-fd-muted-foreground">{text.byline}</span>
        </Link>
        <nav className="flex items-center gap-1" aria-label={text.byline}>
          <a
            href={repositoryUrl}
            className={`${iconButton} sm:w-auto sm:px-2.5`}
            aria-label={text.repository}
            title={text.repository}
            target="_blank"
            rel="noreferrer"
          >
            <GitBranch aria-hidden="true" />
            <span className="hidden text-sm font-medium sm:inline">GitHub</span>
          </a>
          <Link
            href={switchLocalePath(pathname, other)}
            className={iconButton}
            aria-label={text.switchLanguage}
            title={text.switchLanguage}
            hrefLang={other}
          >
            <Languages aria-hidden="true" />
          </Link>
          <ThemeMenu locale={locale} />
        </nav>
      </div>
    </header>
  );
}

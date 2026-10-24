import '../globals.css';
import { i18nProvider } from 'fumadocs-ui/i18n';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { DocsBar } from '@/components/docs-bar';
import DocsSearchDialog from '@/components/search';
import { SiteHeader } from '@/components/site-header';
import { fontMono, fontSans } from '@/lib/fonts';
import { htmlLang, i18n, isLocale } from '@/lib/i18n';
import { layoutOptions, translations } from '@/lib/layout.shared';
import { source } from '@/lib/source';

export const dynamicParams = false;

export function generateStaticParams() {
  return i18n.languages.map(lang => ({ lang }));
}

interface LayoutProps {
  params: Promise<{ lang: string }>;
  children: ReactNode;
}

export default async function Layout({ params, children }: LayoutProps) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <html
      lang={htmlLang[lang]}
      className={`${fontSans.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col font-sans">
        <RootProvider
          i18n={i18nProvider(translations, lang)}
          search={{ SearchDialog: DocsSearchDialog }}
          theme={{ defaultTheme: 'system', enableSystem: true, disableTransitionOnChange: true }}
        >
          <SiteHeader locale={lang} />
          <DocsLayout
            {...layoutOptions}
            tree={source.getPageTree(lang)}
            slots={{ header: DocsBar }}
            sidebar={{ collapsible: false }}
          >
            {children}
          </DocsLayout>
        </RootProvider>
      </body>
    </html>
  );
}

import '@/styles/globals.css';
import { clsx } from 'clsx';
import type { Metadata, Viewport } from 'next';

import Analytics from '@/components/basic/google-analytics';
import { fontMono, fontSans } from '@/config/fonts';
import { siteConfig } from '@/config/site';
import packageJson from '@/package.json';
import { getGlobalConfig } from '@/services/config.server';
import { getLocale, getMessages } from 'next-intl/server';
import { Providers } from './providers';

import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: {
    default: 'Kuma Mieru',
    template: siteConfig.name ? `%s - ${siteConfig.name}` : '%s - Kuma Mieru',
  },
  description: siteConfig.description || 'Kuma Mieru',
  icons: {
    icon: siteConfig.iconCandidates,
  },
  generator: `https://github.com/Alice39s/kuma-mieru v${packageJson.version}`,
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Parallel fetch i18n data and global config to reduce waiting time
  const [locale, messages, { config }] = await Promise.all([
    getLocale(),
    getMessages(),
    getGlobalConfig(),
  ]);

  const { theme, googleAnalyticsId } = config;

  return (
    <html suppressHydrationWarning={true} lang={locale}>
      <head />
      <body
        className={clsx(
          'min-h-screen bg-background font-sans antialiased',
          fontSans.variable,
          fontMono.variable
        )}
      >
        {googleAnalyticsId && <Analytics id={googleAnalyticsId} />}
        <Providers
          locale={locale}
          messages={messages}
          themeProps={{ attribute: 'class', defaultTheme: theme }}
        >
          <div className="min-h-screen bg-background">
            {children}
            <Toaster position="top-center" richColors />
          </div>
        </Providers>
      </body>
    </html>
  );
}

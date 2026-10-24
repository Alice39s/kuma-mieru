import '@/styles/globals.css';
import { clsx } from 'clsx';
import type { Metadata, Viewport } from 'next';

import { buildDefaultMetadata } from '@/app/lib/site-metadata';
import { fontMono, fontSans } from '@/config/fonts';
import { getLocale, getMessages } from 'next-intl/server';
import { Providers } from './providers';

import { Toaster } from 'sonner';

export const metadata: Metadata = buildDefaultMetadata();

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

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
        <Providers locale={locale} messages={messages} themeProps={{ attribute: 'class' }}>
          <div className="min-h-screen bg-background">
            {children}
            <Toaster position="top-center" richColors />
          </div>
        </Providers>
      </body>
    </html>
  );
}

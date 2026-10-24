import '../globals.css';
import type { ReactNode } from 'react';
import { fontMono, fontSans } from '@/lib/fonts';

/** The language chooser at the site root has its own document; each language is a separate root layout. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${fontSans.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col bg-fd-background font-sans text-fd-foreground">
        {children}
      </body>
    </html>
  );
}

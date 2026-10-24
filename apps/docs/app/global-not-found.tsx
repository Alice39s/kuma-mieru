import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { HeartbeatStrip } from '@/components/heartbeat-strip';
import { fontMono, fontSans } from '@/lib/fonts';
import { siteText } from '@/lib/layout.shared';
import { siteName } from '@/lib/shared';

export const metadata: Metadata = {
  title: `404 · ${siteName}`,
};

/** GitHub Pages serves this file for every missing path, so it speaks both languages. */
export default function GlobalNotFound() {
  return (
    <html
      lang="zh-CN"
      className={`${fontSans.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col bg-fd-background font-sans text-fd-foreground">
        <main className="mx-auto flex w-full max-w-xl grow flex-col justify-center gap-6 px-6 py-16">
          <HeartbeatStrip count={24} />
          <div className="flex flex-col gap-2">
            <p className="text-meta text-fd-muted-foreground">404</p>
            <h1 className="text-h1">
              {siteText.zh.notFoundTitle} · <span lang="en">{siteText.en.notFoundTitle}</span>
            </h1>
            <p className="text-body text-fd-muted-foreground">{siteText.zh.notFoundBody}</p>
            <p lang="en" className="text-body text-fd-muted-foreground">
              {siteText.en.notFoundBody}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/zh"
              className="rounded-(--radius) bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
            >
              {siteText.zh.backToDocs}
            </Link>
            <Link
              href="/en"
              lang="en"
              className="rounded-(--radius) border px-4 py-2 text-sm font-medium transition-colors hover:bg-fd-accent"
            >
              {siteText.en.backToDocs}
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}

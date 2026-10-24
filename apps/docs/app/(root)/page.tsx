import type { Metadata } from 'next';
import Link from 'next/link';
import { HeartbeatStrip } from '@/components/heartbeat-strip';
import { siteText } from '@/lib/layout.shared';
import { absoluteUrl, basePath, siteName } from '@/lib/shared';

export const metadata: Metadata = {
  title: `${siteName} ${siteText.zh.byline}`,
  alternates: { canonical: absoluteUrl('/zh/') },
};

/** Readers whose first browser language is not Chinese go to the English docs; everyone else to the Chinese docs. */
const redirect = `(() => {
  const first = (navigator.languages[0] ?? navigator.language ?? '').toLowerCase();
  location.replace('${basePath}/' + (first === '' || first.startsWith('zh') ? 'zh/' : 'en/'));
})();`;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md grow flex-col justify-center gap-6 px-6 py-16">
      <script dangerouslySetInnerHTML={{ __html: redirect }} />
      <HeartbeatStrip count={24} />
      <h1 className="text-h1">{siteName}</h1>
      <nav
        aria-label={`${siteText.zh.chooseLanguage} / ${siteText.en.chooseLanguage}`}
        className="flex flex-col gap-2"
      >
        <Link
          href="/zh"
          hrefLang="zh-CN"
          className="rounded-(--radius-card) border bg-fd-card p-4 text-card-title transition-colors hover:bg-fd-accent"
        >
          简体中文文档
        </Link>
        <Link
          href="/en"
          hrefLang="en"
          className="rounded-(--radius-card) border bg-fd-card p-4 text-card-title transition-colors hover:bg-fd-accent"
        >
          English documentation
        </Link>
      </nav>
    </main>
  );
}

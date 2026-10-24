import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  PageLastUpdate,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import { htmlLang, i18n } from '@/lib/i18n';
import {
  absoluteUrl,
  basePath,
  pageImagePath,
  pageMarkdownPath,
  pagePath,
  repository,
  repositoryUrl,
  siteName,
} from '@/lib/shared';
import { siteText } from '@/lib/layout.shared';
import { type DocsPage as Page, source } from '@/lib/source';

export const dynamicParams = false;

export function generateStaticParams() {
  return source.generateParams('slug', 'lang');
}

interface PageProps {
  params: Promise<{ lang: string; slug?: string[] }>;
}

async function resolvePage({ params }: PageProps): Promise<Page> {
  const { lang, slug } = await params;
  const page = source.getPage(slug, lang);
  if (!page) notFound();
  return page;
}

export default async function Page(props: PageProps) {
  const page = await resolvePage(props);
  const MDX = page.data.body;
  const markdownUrl = `${basePath}${pageMarkdownPath(page)}`;
  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      // The table of contents is the page's section navigation, named by its "On this page" heading.
      tableOfContent={{
        style: 'clerk',
        container: { role: 'navigation', 'aria-labelledby': 'toc-title' },
      }}
      className="sm:px-6 md:px-8 md:pt-8 xl:pt-8"
    >
      <DocsTitle className="text-h1">{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0 text-body text-fd-muted-foreground">
        {page.data.description}
      </DocsDescription>
      <div className="flex flex-row flex-wrap items-center gap-2 border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`${repositoryUrl}/blob/${repository.branch}/${repository.contentDir}/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
      {page.data.lastModified && <PageLastUpdate date={page.data.lastModified} />}
    </DocsPage>
  );
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const page = await resolvePage(props);
  const locale = page.locale ?? i18n.defaultLanguage;
  const section = locale === 'en' ? siteText.en.byline : siteText.zh.byline;
  const image = absoluteUrl(pageImagePath(page));
  const url = absoluteUrl(pagePath(page.url));
  const languages = Object.fromEntries(
    i18n.languages.map(language => [
      htmlLang[language],
      absoluteUrl(pagePath(source.getPage(page.slugs, language)?.url ?? page.url)),
    ])
  );
  return {
    title: `${page.data.title} · ${siteName} ${section}`,
    description: page.data.description,
    alternates: { canonical: url, languages },
    openGraph: {
      type: 'article',
      siteName: `${siteName} ${section}`,
      title: page.data.title,
      description: page.data.description,
      url,
      locale: htmlLang[locale === 'en' ? 'en' : 'zh'],
      images: [{ url: image, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', images: [image] },
  };
}

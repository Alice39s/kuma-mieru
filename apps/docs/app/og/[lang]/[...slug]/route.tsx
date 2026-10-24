import { getBreadcrumbItems } from 'fumadocs-core/breadcrumb';
import { notFound } from 'next/navigation';
import { ImageResponse } from 'takumi-js/response';
import { htmlLang, isLocale } from '@/lib/i18n';
import { siteText } from '@/lib/layout.shared';
import { OgImage, ogSize } from '@/lib/og-image';
import { ogFontFamily, ogRenderer } from '@/lib/og.server';
import { basePath, siteOrigin } from '@/lib/shared';
import { source } from '@/lib/source';

export const dynamic = 'force-static';
export const dynamicParams = false;

const FILE_NAME = 'image.png';

export function generateStaticParams() {
  return source
    .getLanguages()
    .flatMap(({ language, pages }) =>
      pages.map(page => ({ lang: language, slug: [...page.slugs, FILE_NAME] }))
    );
}

/** The folders above a page, joined with " / "; the last one is left out when it repeats the page title. */
function sectionOf(url: string, lang: string, title: string): string | undefined {
  const names = getBreadcrumbItems(url, source.getPageTree(lang), { includePage: false })
    .map(item => item.name)
    .filter(name => typeof name === 'string');
  if (names.at(-1) === title) names.pop();
  return names.length > 0 ? names.join(' / ') : undefined;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lang: string; slug: string[] }> }
) {
  const { lang, slug } = await params;
  if (!isLocale(lang) || slug.at(-1) !== FILE_NAME) notFound();
  const slugs = slug.slice(0, -1);
  const page = source.getPage(slugs, lang);
  if (!page) notFound();
  const image = (
    <OgImage
      title={page.data.title}
      description={page.data.description}
      section={sectionOf(page.url, lang, page.data.title)}
      byline={siteText[lang].byline}
      host={`${new URL(siteOrigin).host}${basePath}`}
    />
  );
  return new ImageResponse(image, {
    ...ogSize,
    renderer: await ogRenderer(),
    fontFamilies: [ogFontFamily],
    lang: htmlLang[lang],
    format: 'png',
  });
}

import { notFound } from 'next/navigation';
import { docsLlms, publicPage, source } from '@/lib/source';

export const dynamic = 'force-static';
export const dynamicParams = false;

const FILE_NAME = 'content.md';

export function generateStaticParams() {
  return source
    .getLanguages()
    .flatMap(({ language, pages }) =>
      pages.map(page => ({ lang: language, slug: [...page.slugs, FILE_NAME] }))
    );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lang: string; slug: string[] }> }
) {
  const { lang, slug } = await params;
  if (slug.at(-1) !== FILE_NAME) notFound();
  const page = source.getPage(slug.slice(0, -1), lang);
  if (!page) notFound();
  return new Response(await docsLlms.page(publicPage(page)), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}

import { notFound } from 'next/navigation';
import { i18n, isLocale } from '@/lib/i18n';
import { docsLlms } from '@/lib/source';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return i18n.languages.map(lang => ({ lang }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return new Response(await docsLlms.full(lang), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

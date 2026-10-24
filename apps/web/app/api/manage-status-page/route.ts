import { getConfig } from '@/config/api';
import { normalizeBaseUrl } from '@/utils/url';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedPageId = searchParams.get('pageId') ?? undefined;
  const config = getConfig(requestedPageId) ?? getConfig();

  if (!config || !config.isEditThisPage) {
    return NextResponse.redirect(new URL('/', request.url), 307);
  }

  const target = `${normalizeBaseUrl(config.baseUrl)}/manage-status-page`;
  return NextResponse.redirect(target, 307);
}

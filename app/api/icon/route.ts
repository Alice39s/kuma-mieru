import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPageIdFromRequest } from '@/app/lib/api-utils';
import { getAvailablePageIds, getConfig } from '@/config/api';
import { getUpstreamIconUrl } from '@/services/config.server';
import { customFetch } from '@/services/utils/fetch';
import { getErrorMessage } from '@/utils/errors';
import { NextResponse } from 'next/server';
import {
  isProxyableIconContentType,
  normalizeIconValue,
  parseIconContentLength,
  resolveUpstreamIconUrl,
} from './icon-proxy';

export const runtime = 'nodejs';

const MAX_ICON_SIZE = 2 * 1024 * 1024; // 2MB
const FALLBACK_ICON_PATH = join(process.cwd(), 'public', 'icon.svg');
const FALLBACK_ICON_CACHE_CONTROL = 'public, max-age=300, s-maxage=300, stale-while-revalidate=600';
const FALLBACK_ICON_DATA = readFile(FALLBACK_ICON_PATH)
  .then(data => new Uint8Array(data))
  .catch(error => {
    console.error('Failed to load fallback icon from disk', {
      path: FALLBACK_ICON_PATH,
      error: getErrorMessage(error),
    });
    return null;
  });

async function fallback(): Promise<NextResponse> {
  const data = await FALLBACK_ICON_DATA;
  if (!data) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': FALLBACK_ICON_CACHE_CONTROL,
    },
  });
}

export async function GET(request: Request) {
  const requestedPageId = getPageIdFromRequest(request, getAvailablePageIds());

  const pageConfig = getConfig(requestedPageId) ?? getConfig();
  if (!pageConfig) {
    return fallback();
  }

  try {
    const icon =
      normalizeIconValue(pageConfig.siteMeta.icon) ??
      normalizeIconValue(await getUpstreamIconUrl(pageConfig));
    if (!icon) {
      return fallback();
    }

    const targetUrl = resolveUpstreamIconUrl(icon, pageConfig.baseUrl);
    if (!targetUrl) {
      return fallback();
    }

    const upstreamResponse = await customFetch(targetUrl, {
      headers: { Accept: 'image/*,*/*;q=0.8' },
      timeout: 10000,
      maxResponseBytes: MAX_ICON_SIZE,
    });

    if (!upstreamResponse.ok) {
      return fallback();
    }

    const contentType = upstreamResponse.headers['content-type'] || '';
    if (!isProxyableIconContentType(contentType)) {
      return fallback();
    }

    const contentLength = parseIconContentLength(upstreamResponse.headers['content-length']);
    if (contentLength !== null && contentLength > MAX_ICON_SIZE) {
      return fallback();
    }

    const data = await upstreamResponse.arrayBuffer();
    if (data.byteLength > MAX_ICON_SIZE) {
      return fallback();
    }

    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Failed to proxy icon', {
      pageId: pageConfig.pageId,
      error: getErrorMessage(error),
    });
    return fallback();
  }
}

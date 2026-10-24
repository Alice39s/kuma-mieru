import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig } from '@/config/api';
import { getUpstreamIconUrl } from '@/services/config.server';
import { customFetch } from '@/services/utils/fetch';
import { normalizeBaseUrl } from '@/utils/url';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const FALLBACK_ICON = '/icon.svg';
const MAX_ICON_SIZE = 2 * 1024 * 1024; // 2MB
const FALLBACK_ICON_PATH = join(process.cwd(), 'public', 'icon.svg');
const FALLBACK_ICON_CACHE_CONTROL = 'public, max-age=300, s-maxage=300, stale-while-revalidate=600';
const FALLBACK_ICON_DATA = readFile(FALLBACK_ICON_PATH)
  .then(data => new Uint8Array(data))
  .catch(error => {
    console.error('Failed to load fallback icon from disk', {
      path: FALLBACK_ICON_PATH,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

function normalizeIconValue(icon: string | null | undefined): string | null {
  if (typeof icon !== 'string') return null;

  const trimmed = icon.trim();
  if (!trimmed) return null;

  const isWrappedByDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
  const isWrappedBySingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'");

  if ((isWrappedByDoubleQuotes || isWrappedBySingleQuotes) && trimmed.length >= 2) {
    const unwrapped = trimmed.slice(1, -1).trim();
    return unwrapped || null;
  }

  return trimmed;
}

function resolveUpstreamIconUrl(icon: string, baseUrl: string): string | null {
  if (!icon || icon === FALLBACK_ICON || icon.startsWith('data:')) return null;

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const baseOrigin = new URL(normalizedBaseUrl).origin;

  if (/^https?:\/\//i.test(icon)) {
    const parsed = new URL(icon);
    if (parsed.origin !== baseOrigin) return null;
    return parsed.toString();
  }

  if (icon.startsWith('//')) return null;

  return `${normalizedBaseUrl}/${icon.replace(/^\/+/, '')}`;
}

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
  const { searchParams } = new URL(request.url);
  const requestedPageId = searchParams.get('pageId') ?? undefined;

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
    });

    if (!upstreamResponse.ok) {
      return fallback();
    }

    const contentType = upstreamResponse.headers['content-type'] || '';
    if (!contentType.startsWith('image/')) {
      return fallback();
    }

    const contentLength = Number(upstreamResponse.headers['content-length'] || '0');
    if (contentLength > MAX_ICON_SIZE) {
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
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback();
  }
}

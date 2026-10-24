/**
 * Uptime Kuma status page URL parsing — single source of truth.
 *
 * Used by both generate-config.ts and generate-image-domains.ts.
 */

import { normalizeBaseUrl } from '../../utils/url';

const STATUS_SEGMENT = 'status';

export function parseStatusPageUrl(rawUrl: string): { baseUrl: string; pageId: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL in UPTIME_KUMA_URLS: ${rawUrl}`);
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const statusIndex = segments.findIndex(s => s.toLowerCase() === STATUS_SEGMENT);

  if (statusIndex < 0 || statusIndex >= segments.length - 1) {
    throw new Error(
      `Expected status page URL like https://example.com/status/<pageId>, got: ${rawUrl}`
    );
  }

  const pageId = decodeURIComponent(segments[statusIndex + 1] ?? '').trim();
  if (!pageId) {
    throw new Error(`Empty page id in URL: ${rawUrl}`);
  }

  const basePathSegments = segments.slice(0, statusIndex);
  const basePath = basePathSegments.length > 0 ? `/${basePathSegments.join('/')}` : '';

  return {
    baseUrl: normalizeBaseUrl(`${parsed.origin}${basePath}`),
    pageId,
  };
}

interface EndpointConfig {
  baseUrl: string;
  pageIds: string[];
  pageEndpoints: Array<{ id: string; baseUrl: string }>;
  source: 'UPTIME_KUMA_URLS' | 'UPTIME_KUMA_BASE_URL+PAGE_ID';
}

function splitUrls(raw: string): string[] {
  return raw
    .split('|')
    .map(s => s.trim())
    .filter(Boolean);
}

function parsePageIds(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map(id => id.trim())
        .filter(Boolean)
    )
  );
}

export function resolveEndpointConfig(): EndpointConfig {
  const rawUrls = process.env.UPTIME_KUMA_URLS?.trim();

  if (rawUrls) {
    const urls = splitUrls(rawUrls);
    if (urls.length === 0) {
      throw new Error('UPTIME_KUMA_URLS must contain at least one status page URL');
    }

    const parsed = urls.map(parseStatusPageUrl);
    const pageEndpoints: Array<{ id: string; baseUrl: string }> = [];
    const seenPageBase = new Map<string, string>();

    for (const item of parsed) {
      const seenBaseUrl = seenPageBase.get(item.pageId);

      if (!seenBaseUrl) {
        seenPageBase.set(item.pageId, item.baseUrl);
        pageEndpoints.push({ id: item.pageId, baseUrl: item.baseUrl });
        continue;
      }

      if (seenBaseUrl !== item.baseUrl) {
        throw new Error(
          `Duplicate page id "${item.pageId}" appears under multiple base URLs in ` +
            `UPTIME_KUMA_URLS: ${seenBaseUrl} and ${item.baseUrl}. ` +
            'Please ensure each page id is globally unique.'
        );
      }
    }

    const baseUrl = pageEndpoints[0]?.baseUrl;
    if (!baseUrl) {
      throw new Error('UPTIME_KUMA_URLS must contain at least one valid status page URL');
    }

    const pageIds = pageEndpoints.map(item => item.id);

    if (process.env.UPTIME_KUMA_BASE_URL || process.env.PAGE_ID) {
      console.log('[env] UPTIME_KUMA_URLS is set — UPTIME_KUMA_BASE_URL and PAGE_ID are ignored');
    }

    return { baseUrl, pageIds, pageEndpoints, source: 'UPTIME_KUMA_URLS' };
  }

  const baseUrl = process.env.UPTIME_KUMA_BASE_URL;
  const rawPageIds = process.env.PAGE_ID;

  if (!baseUrl) throw new Error('UPTIME_KUMA_BASE_URL is required (or set UPTIME_KUMA_URLS)');
  if (!rawPageIds) throw new Error('PAGE_ID is required (or set UPTIME_KUMA_URLS)');

  const pageIds = parsePageIds(rawPageIds);
  if (pageIds.length === 0) {
    throw new Error('PAGE_ID must contain at least one status page identifier');
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    pageIds,
    pageEndpoints: pageIds.map(id => ({ id, baseUrl: normalizeBaseUrl(baseUrl) })),
    source: 'UPTIME_KUMA_BASE_URL+PAGE_ID',
  };
}

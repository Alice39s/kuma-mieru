/**
 * Uptime Kuma status page URL parsing — single source of truth.
 *
 * Used by both generate-config.ts and generate-image-domains.ts.
 */

const STATUS_SEGMENT = 'status';

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

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
    const baseUrl = parsed[0]!.baseUrl;

    const mismatch = parsed.find(p => p.baseUrl !== baseUrl);
    if (mismatch) {
      throw new Error(
        `All URLs in UPTIME_KUMA_URLS must share the same base URL. ` +
          `Expected ${baseUrl}, got ${mismatch.baseUrl}`
      );
    }

    const pageIds = Array.from(new Set(parsed.map(p => p.pageId)));

    if (process.env.UPTIME_KUMA_BASE_URL || process.env.PAGE_ID) {
      console.log('[env] UPTIME_KUMA_URLS is set — UPTIME_KUMA_BASE_URL and PAGE_ID are ignored');
    }

    return { baseUrl, pageIds, source: 'UPTIME_KUMA_URLS' };
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
    source: 'UPTIME_KUMA_BASE_URL+PAGE_ID',
  };
}

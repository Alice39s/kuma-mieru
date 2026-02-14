import type { CheerioAPI } from 'cheerio';
import type { PreloadData } from '../types/config';
import { ConfigError } from './errors';
import { validatePreloadData } from './json-sanitizer';

type PreloadSource = 'script' | 'data-json';

type MinimalResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

export interface PreloadExtractionResult {
  payload: string | null;
  source: PreloadSource | null;
}

export interface FetchPreloadDataOptions {
  baseUrl: string;
  pageId: string;
  fetchFn?: (url: string, init?: Record<string, unknown>) => Promise<MinimalResponse>;
  requestInit?: Record<string, unknown>;
}

export interface ApiPreloadResult {
  data: PreloadData;
  url: string;
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return { ...headers };
}

function ensureAcceptHeader(headers: Record<string, string>) {
  const hasAcceptHeader = Object.keys(headers).some(key => key.toLowerCase() === 'accept');
  if (!hasAcceptHeader) {
    headers.Accept = 'application/json';
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export function getPreloadPayload($: CheerioAPI): PreloadExtractionResult {
  const preloadElement = $('#preload-data');

  if (!preloadElement || preloadElement.length === 0) {
    return { payload: null, source: null };
  }

  const scriptContent = preloadElement.text()?.trim();
  if (scriptContent) {
    return { payload: scriptContent, source: 'script' };
  }

  const dataJson = preloadElement.attr('data-json');
  if (dataJson) {
    const trimmed = dataJson.trim();
    if (trimmed && trimmed !== '{}' && trimmed !== '[]') {
      return { payload: trimmed, source: 'data-json' };
    }
  }

  return { payload: null, source: null };
}

export async function fetchPreloadDataFromApi({
  baseUrl,
  pageId,
  fetchFn,
  requestInit,
}: FetchPreloadDataOptions): Promise<ApiPreloadResult> {
  if (!baseUrl || !pageId) {
    throw new ConfigError('Base URL and page ID are required to fetch preload data from API');
  }

  const normalizedBase = normalizeBaseUrl(baseUrl);
  const url = `${normalizedBase}/api/status-page/${pageId}`;

  const normalizedHeaders = normalizeHeaders(requestInit?.headers as HeadersInit | undefined);
  ensureAcceptHeader(normalizedHeaders);

  const finalInit: Record<string, unknown> = {
    ...requestInit,
    headers: normalizedHeaders,
  };

  const effectiveFetch =
    fetchFn ??
    (async (input: string, init?: Record<string, unknown>) => fetch(input, init as RequestInit));

  let response: MinimalResponse;

  try {
    response = await effectiveFetch(url, finalInit);
  } catch (error) {
    throw new ConfigError('Failed to request preload data from API', error);
  }

  if (!response.ok) {
    throw new ConfigError(
      `Failed to fetch preload data from API: ${response.status} ${response.statusText}`
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (error) {
    throw new ConfigError('Failed to parse preload data API response as JSON', error);
  }

  if (!validatePreloadData(parsed)) {
    throw new ConfigError('Preload data API response is missing required fields');
  }

  return {
    data: parsed,
    url,
  };
}

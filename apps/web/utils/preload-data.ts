import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';
import type { PreloadData } from '../types/config';
import { ConfigError } from './errors';
import { extractPreloadData } from './json-processor';
import { sanitizeJsonString, validatePreloadData } from './json-sanitizer';
import { normalizeBaseUrl } from './url';

type PreloadSource = 'script' | 'data-json';
type ResolvedPreloadSource = PreloadSource | 'legacy-window-preload' | 'api-fallback';

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

export interface PreloadLogger {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export interface ResolvePreloadDataFromHtmlOptions extends FetchPreloadDataOptions {
  html: string;
  logger?: PreloadLogger;
  includeHtmlDiagnostics?: boolean;
}

export interface ResolvedPreloadData {
  data: PreloadData;
  source: ResolvedPreloadSource;
}

const PRELOAD_SCRIPT_WITH_ID_REGEX =
  /<script\b([^>]*\bid\s*=\s*(['"])preload-data\2[^>]*)>([\s\S]*?)<\/script>/i;
const DATA_JSON_ATTR_REGEX = /\bdata-json\s*=\s*("([^"]*)"|'([^']*)')/i;
const LEGACY_PRELOAD_REGEX = /window\.preloadData\s*=\s*({[\s\S]*?});/;

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

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:quot|apos|amp|lt|gt|#39|#x27|#(\d+)|#x([0-9a-fA-F]+));/g, match => {
    switch (match) {
      case '&quot;':
        return '"';
      case '&apos;':
      case '&#39;':
      case '&#x27;':
        return "'";
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      default: {
        const decimalMatch = match.match(/^&#(\d+);$/);
        if (decimalMatch?.[1]) {
          const codePoint = Number.parseInt(decimalMatch[1], 10);
          return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
        }

        const hexMatch = match.match(/^&#x([0-9a-fA-F]+);$/);
        if (hexMatch?.[1]) {
          const codePoint = Number.parseInt(hexMatch[1], 16);
          return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
        }

        return match;
      }
    }
  });
}

function getPreloadPayloadFromHtmlFast(html: string): PreloadExtractionResult {
  const match = html.match(PRELOAD_SCRIPT_WITH_ID_REGEX);
  if (!match) {
    return { payload: null, source: null };
  }

  const attributes = match[1] ?? '';
  const scriptContent = match[3]?.trim() ?? '';

  if (scriptContent) {
    return { payload: scriptContent, source: 'script' };
  }

  const dataJsonMatch = attributes.match(DATA_JSON_ATTR_REGEX);
  if (dataJsonMatch) {
    const encodedDataJson = dataJsonMatch[2] ?? dataJsonMatch[3] ?? '';
    const dataJson = decodeHtmlEntities(encodedDataJson).trim();
    if (dataJson && dataJson !== '{}' && dataJson !== '[]') {
      return { payload: dataJson, source: 'data-json' };
    }
  }

  return { payload: null, source: null };
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

function parsePreloadPayload(payload: string): PreloadData {
  try {
    const jsonStr = sanitizeJsonString(payload);
    return extractPreloadData(jsonStr);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ConfigError(
        `JSON parsing failed: ${error.message}\nProcessed data: ${payload.slice(0, 100)}...`,
        error
      );
    }

    if (error instanceof ConfigError) {
      throw error;
    }

    throw new ConfigError(
      `Failed to parse preload data: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    );
  }
}

function tryResolvePayload(
  payload: string,
  source: ResolvedPreloadSource,
  logger: PreloadLogger,
  strategy: 'fast-path' | 'cheerio'
): ResolvedPreloadData | null {
  try {
    return {
      data: parsePreloadPayload(payload),
      source,
    };
  } catch (error) {
    logger.debug?.(
      `Failed to parse preload payload in ${strategy}, fallback to next strategy`,
      error
    );
    return null;
  }
}

function extractLegacyPreloadPayload($: CheerioAPI, logger: PreloadLogger): string | null {
  const scriptWithPreloadData = $('script:contains("window.preloadData")').text();
  if (!scriptWithPreloadData) {
    return null;
  }

  const match = scriptWithPreloadData.match(/window\.preloadData\s*=\s*({[\s\S]*?});/);
  if (match && match[1]) {
    logger.info?.('Successfully extracted preload data from window.preloadData');
    return match[1];
  }

  logger.error?.(
    'Failed to extract preload data with regex. Script content:',
    scriptWithPreloadData.slice(0, 200)
  );

  return null;
}

function extractLegacyPreloadPayloadFromHtmlFast(html: string): string | null {
  const match = html.match(LEGACY_PRELOAD_REGEX);
  if (match && match[1]) {
    return match[1];
  }

  return null;
}

export async function resolvePreloadDataFromHtml({
  html,
  baseUrl,
  pageId,
  fetchFn,
  requestInit,
  logger = console,
  includeHtmlDiagnostics = false,
}: ResolvePreloadDataFromHtmlOptions): Promise<ResolvedPreloadData> {
  const fastPreload = getPreloadPayloadFromHtmlFast(html);
  if (fastPreload.payload) {
    if (fastPreload.source === 'data-json') {
      logger.debug?.('Using preload data from data-json attribute (fast path)');
    }

    const resolvedFastPreload = tryResolvePayload(
      fastPreload.payload,
      fastPreload.source ?? 'script',
      logger,
      'fast-path'
    );
    if (resolvedFastPreload) {
      return resolvedFastPreload;
    }
  }

  const fastLegacyPayload = extractLegacyPreloadPayloadFromHtmlFast(html);
  if (fastLegacyPayload) {
    logger.info?.('Successfully extracted preload data from window.preloadData (fast path)');
    const resolvedFastLegacy = tryResolvePayload(
      fastLegacyPayload,
      'legacy-window-preload',
      logger,
      'fast-path'
    );
    if (resolvedFastLegacy) {
      return resolvedFastLegacy;
    }
  }

  const $ = cheerio.load(html);
  const { payload: cheerioPayload, source: cheerioSource } = getPreloadPayload($);

  if (cheerioPayload) {
    if (cheerioSource === 'data-json') {
      logger.debug?.('Using preload data from data-json attribute');
    }

    return {
      data: parsePreloadPayload(cheerioPayload),
      source: cheerioSource ?? 'script',
    };
  }

  const legacyPayload = extractLegacyPreloadPayload($, logger);
  if (legacyPayload) {
    const resolvedLegacy = tryResolvePayload(
      legacyPayload,
      'legacy-window-preload',
      logger,
      'cheerio'
    );
    if (resolvedLegacy) {
      return resolvedLegacy;
    }
  }

  logger.warn?.('Preload script missing, attempting status page API fallback');

  try {
    const apiFallback = await fetchPreloadDataFromApi({
      baseUrl,
      pageId,
      fetchFn,
      requestInit,
    });
    logger.info?.('Using status page API fallback for preload data', { url: apiFallback.url });
    return {
      data: apiFallback.data,
      source: 'api-fallback',
    };
  } catch (apiError) {
    logger.error?.('Status page API fallback failed:', apiError);
  }

  if (includeHtmlDiagnostics) {
    logger.error?.('HTML response preview:', html.slice(0, 500));
    logger.error?.(
      'Available script tags:',
      $('script')
        .map((_, el) => $(el).attr('id') || 'no-id')
        .get()
    );
  }

  throw new ConfigError('Preload script tag not found or empty');
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

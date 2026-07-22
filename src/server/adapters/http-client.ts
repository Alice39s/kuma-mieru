import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type Database from 'better-sqlite3';
import type { z } from 'zod';
import type { SourceJsonRequester } from './types.js';

type ResolveHost = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<Array<{ address: string; family: number }>>;

export interface HttpJsonResponse {
  status: 200 | 304;
  data: unknown;
  etag: string | null;
  lastModified: string | null;
}

export interface HttpJsonClientOptions {
  allowPrivateAddresses?: boolean;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
  fetchImplementation?: typeof fetch;
  resolveHost?: ResolveHost;
}

interface CacheRow {
  etag: string | null;
  last_modified: string | null;
  payload_json: string;
}

const requestError = (code: string, message: string) => Object.assign(new Error(message), { code });

const isPrivateIpv4 = (address: string) => {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return true;
  }
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
};

const isPrivateAddress = (input: string) => {
  const address = input.replaceAll('[', '').replaceAll(']', '').toLowerCase();
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family !== 6) return true;
  if (address === '::' || address === '::1') return true;
  if (address.startsWith('fc') || address.startsWith('fd')) return true;
  if (['fe8', 'fe9', 'fea', 'feb'].some(prefix => address.startsWith(prefix))) return true;
  if (address.startsWith('::ffff:')) return isPrivateIpv4(address.slice(7));
  return false;
};

const validateTarget = async (
  url: URL,
  allowPrivateAddresses: boolean,
  resolveHost: ResolveHost
) => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw requestError('unsupported_protocol', 'Source URL must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw requestError('embedded_credentials', 'Source URL must not contain credentials');
  }
  if (allowPrivateAddresses) return;

  const hostname = url.hostname.replaceAll('[', '').replaceAll(']', '');
  if (hostname.toLowerCase() === 'localhost') {
    throw requestError('private_address_blocked', 'Private source address is not allowed');
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolveHost(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(result => isPrivateAddress(result.address))) {
    throw requestError('private_address_blocked', 'Private source address is not allowed');
  }
};

const readLimitedBody = async (response: Response, maxBodyBytes: number) => {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel();
      throw requestError('body_too_large', `Source response exceeded ${maxBodyBytes} bytes`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  chunks.forEach(chunk => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return body;
};

export const createHttpJsonClient = (options: HttpJsonClientOptions = {}) => {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const resolveHost = options.resolveHost ?? (lookup as ResolveHost);
  const allowPrivateAddresses = options.allowPrivateAddresses ?? false;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBodyBytes = options.maxBodyBytes ?? 2 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 3;

  return async (inputUrl: URL, headers: Record<string, string> = {}): Promise<HttpJsonResponse> => {
    let url = new URL(inputUrl);
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      await validateTarget(url, allowPrivateAddresses, resolveHost);
      const response = await fetchImplementation(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        const location = response.headers.get('location');
        if (!location || redirectCount === maxRedirects) {
          throw requestError('redirect_rejected', 'Source redirect limit exceeded');
        }
        url = new URL(location, url);
        continue;
      }
      if (response.status === 304) {
        return {
          status: 304,
          data: null,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
        };
      }
      if (!response.ok) {
        throw requestError(`http_${response.status}`, `Source returned HTTP ${response.status}`);
      }
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.includes('application/json') && !contentType.includes('+json')) {
        throw requestError('invalid_content_type', 'Source did not return JSON');
      }
      const body = await readLimitedBody(response, maxBodyBytes);
      let data: unknown;
      try {
        data = JSON.parse(new TextDecoder().decode(body));
      } catch {
        throw requestError('invalid_json', 'Source returned invalid JSON');
      }
      return {
        status: 200,
        data,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      };
    }
    throw requestError('redirect_rejected', 'Source redirect limit exceeded');
  };
};

export const createCachedSourceRequester = (
  database: Database.Database,
  sourceId: string,
  requestJson = createHttpJsonClient()
): SourceJsonRequester => ({
  request: async <T>(url: URL, resourceKey: string, schema: z.ZodType<T>) => {
    const endpointHash = createHash('sha256')
      .update(`${url.origin}${url.pathname}`, 'utf8')
      .digest('hex')
      .slice(0, 16);
    const cacheKey = `${resourceKey}:${endpointHash}`;
    const cached = database
      .prepare(
        `SELECT etag, last_modified, payload_json
         FROM source_http_cache WHERE source_id = ? AND resource_key = ?`
      )
      .get(sourceId, cacheKey) as CacheRow | undefined;
    const headers: Record<string, string> = {};
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.last_modified) headers['If-Modified-Since'] = cached.last_modified;

    const response = await requestJson(url, headers);
    if (response.status === 304) {
      if (!cached) throw requestError('invalid_not_modified', 'Source returned 304 without cache');
      return schema.parse(JSON.parse(cached.payload_json));
    }

    const parsed = schema.parse(response.data);
    database
      .prepare(
        `INSERT INTO source_http_cache
          (source_id, resource_key, etag, last_modified, payload_json, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id, resource_key) DO UPDATE SET
           etag = excluded.etag,
           last_modified = excluded.last_modified,
           payload_json = excluded.payload_json,
           fetched_at = excluded.fetched_at`
      )
      .run(
        sourceId,
        cacheKey,
        response.etag,
        response.lastModified,
        JSON.stringify(parsed),
        new Date().toISOString()
      );
    return parsed;
  },
});

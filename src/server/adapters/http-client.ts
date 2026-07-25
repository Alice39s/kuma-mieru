import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type Database from 'better-sqlite3';
import { Agent, fetch as undiciFetch, interceptors, type Dispatcher } from 'undici';
import type { z } from 'zod';
import type { SourceJsonRequester } from './types.js';

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

type ResolveHost = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<Array<{ address: string; family: number }>>;

type PinnedFetch = (
  input: string | URL,
  init: RequestInit & { dispatcher: Dispatcher }
) => Promise<Response>;

export interface HttpJsonResponse {
  status: 200 | 304;
  data: unknown;
  etag: string | null;
  lastModified: string | null;
}

export interface HttpBinaryResponse {
  status: 200 | 304;
  data: Uint8Array | null;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  finalUrl: URL;
}

export interface HttpJsonClientOptions {
  privateAddressCidrs?: readonly string[];
  allowedOrigins?: readonly string[];
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
  fetchImplementation?: PinnedFetch;
  resolveHost?: ResolveHost;
}

export interface HttpBinaryClientOptions extends HttpJsonClientOptions {
  allowedContentTypes: readonly string[];
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

const privateCidrRanges = [
  { network: '10.0.0.0', prefix: 8, family: 4 },
  { network: '100.64.0.0', prefix: 10, family: 4 },
  { network: '127.0.0.0', prefix: 8, family: 4 },
  { network: '169.254.0.0', prefix: 16, family: 4 },
  { network: '172.16.0.0', prefix: 12, family: 4 },
  { network: '192.168.0.0', prefix: 16, family: 4 },
  { network: '198.18.0.0', prefix: 15, family: 4 },
  { network: '::', prefix: 128, family: 6 },
  { network: '::1', prefix: 128, family: 6 },
  { network: 'fc00::', prefix: 7, family: 6 },
  { network: 'fe80::', prefix: 10, family: 6 },
] as const;

const privateCidrRules = privateCidrRanges.map(range => {
  const blockList = new BlockList();
  blockList.addSubnet(range.network, range.prefix, range.family === 4 ? 'ipv4' : 'ipv6');
  return { ...range, blockList };
});

const isContainedPrivateCidr = (address: string, prefix: number, family: 4 | 6) =>
  privateCidrRules.some(
    rule =>
      rule.family === family &&
      prefix >= rule.prefix &&
      rule.blockList.check(address, family === 4 ? 'ipv4' : 'ipv6')
  );

const createPrivateAddressAllowlist = (cidrs: readonly string[]) => {
  if (cidrs.length > 64) {
    throw requestError(
      'invalid_private_source_cidrs',
      'At most 64 private source CIDRs are allowed'
    );
  }
  const allowlist = new BlockList();
  for (const cidr of new Set(cidrs)) {
    const separator = cidr.lastIndexOf('/');
    const address = cidr.slice(0, separator).trim().toLowerCase();
    const prefixText = cidr.slice(separator + 1).trim();
    const family = isIP(address);
    const prefix = Number(prefixText);
    const maximumPrefix = family === 4 ? 32 : 128;
    if (
      separator <= 0 ||
      (family !== 4 && family !== 6) ||
      prefixText === '' ||
      !Number.isInteger(prefix) ||
      prefix < 0 ||
      prefix > maximumPrefix
    ) {
      throw requestError('invalid_private_source_cidrs', `Invalid private source CIDR: ${cidr}`);
    }
    if (!isContainedPrivateCidr(address, prefix, family)) {
      throw requestError(
        'invalid_private_source_cidrs',
        `Private source CIDR is outside the supported private ranges: ${cidr}`
      );
    }
    allowlist.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return allowlist;
};

export const parsePrivateAddressCidrs = (input: string | undefined) => {
  const cidrs = (input ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  createPrivateAddressAllowlist(cidrs);
  return cidrs;
};

const isAllowlisted = (allowlist: BlockList, input: string) => {
  const address = input.replaceAll('[', '').replaceAll(']', '').toLowerCase();
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) {
    return allowlist.check(address.slice(7), 'ipv4');
  }
  const family = isIP(address);
  return family !== 0 && allowlist.check(address, family === 4 ? 'ipv4' : 'ipv6');
};

const resolveTarget = async (
  url: URL,
  privateAddressAllowlist: BlockList,
  resolveHost: ResolveHost,
  allowedOrigins: ReadonlySet<string> | null
): Promise<ResolvedAddress[]> => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw requestError('unsupported_protocol', 'Source URL must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw requestError('embedded_credentials', 'Source URL must not contain credentials');
  }
  if (url.hash) {
    throw requestError('url_fragment_rejected', 'Source URL must not contain a fragment');
  }
  if (allowedOrigins && !allowedOrigins.has(url.origin)) {
    throw requestError('origin_not_allowed', 'Source redirect left the allowed origin');
  }
  const hostname = url.hostname.replaceAll('[', '').replaceAll(']', '');
  const resolved = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolveHost(hostname, { all: true, verbatim: true });
  const addresses = resolved.flatMap<ResolvedAddress>(result =>
    result.family === 4 || result.family === 6
      ? [{ address: result.address, family: result.family }]
      : []
  );
  if (addresses.length === 0) {
    throw requestError('dns_resolution_failed', 'Source hostname did not resolve to an IP address');
  }
  if (
    addresses.some(
      result =>
        isPrivateAddress(result.address) && !isAllowlisted(privateAddressAllowlist, result.address)
    )
  ) {
    throw requestError('private_address_blocked', 'Private source address is not allowed');
  }
  return addresses;
};

const createPinnedDispatcher = (addresses: ResolvedAddress[]): Dispatcher =>
  new Agent({ connections: 1, pipelining: 1 }).compose(
    interceptors.dns({
      maxTTL: 60_000,
      lookup: (_origin, _options, callback) => {
        callback(
          null,
          addresses.map(address => ({ ...address, ttl: 60_000 }))
        );
      },
    })
  );

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

interface HttpBodyResponse {
  status: 200 | 304;
  body: Uint8Array | null;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  finalUrl: URL;
}

const createHttpBodyClient = (
  options: HttpJsonClientOptions,
  accept: string,
  acceptsContentType: (contentType: string) => boolean,
  invalidContentTypeMessage: string
) => {
  const fetchImplementation = options.fetchImplementation ?? (undiciFetch as PinnedFetch);
  const resolveHost = options.resolveHost ?? (lookup as ResolveHost);
  const privateAddressAllowlist = createPrivateAddressAllowlist(options.privateAddressCidrs ?? []);
  const allowedOrigins = options.allowedOrigins
    ? new Set(options.allowedOrigins.map(origin => new URL(origin).origin))
    : null;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBodyBytes = options.maxBodyBytes ?? 2 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 3;

  return async (inputUrl: URL, headers: Record<string, string> = {}): Promise<HttpBodyResponse> => {
    let url = new URL(inputUrl);
    let requestHeaders = { ...headers };
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const addresses = await resolveTarget(
        url,
        privateAddressAllowlist,
        resolveHost,
        allowedOrigins
      );
      const dispatcher = createPinnedDispatcher(addresses);
      try {
        const response = await fetchImplementation(url, {
          method: 'GET',
          headers: { Accept: accept, ...requestHeaders },
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
          dispatcher,
        });

        if (response.status >= 300 && response.status < 400 && response.status !== 304) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirectCount === maxRedirects) {
            throw requestError('redirect_rejected', 'Source redirect limit exceeded');
          }
          const nextUrl = new URL(location, url);
          if (nextUrl.origin !== url.origin) {
            requestHeaders = Object.fromEntries(
              Object.entries(requestHeaders).filter(
                ([name]) =>
                  !['authorization', 'cookie', 'proxy-authorization'].includes(name.toLowerCase())
              )
            );
          }
          url = nextUrl;
          continue;
        }
        if (response.status === 304) {
          await response.body?.cancel();
          return {
            status: 304,
            body: null,
            contentType: null,
            etag: response.headers.get('etag'),
            lastModified: response.headers.get('last-modified'),
            finalUrl: url,
          };
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw requestError(`http_${response.status}`, `Source returned HTTP ${response.status}`);
        }
        const contentType =
          response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
        if (!acceptsContentType(contentType)) {
          await response.body?.cancel();
          throw requestError('invalid_content_type', invalidContentTypeMessage);
        }
        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
          await response.body?.cancel();
          throw requestError('body_too_large', `Source response exceeded ${maxBodyBytes} bytes`);
        }
        const body = await readLimitedBody(response, maxBodyBytes);
        return {
          status: 200,
          body,
          contentType,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          finalUrl: url,
        };
      } finally {
        await dispatcher.close();
      }
    }
    throw requestError('redirect_rejected', 'Source redirect limit exceeded');
  };
};

export const createHttpJsonClient = (options: HttpJsonClientOptions = {}) => {
  const requestBody = createHttpBodyClient(
    options,
    'application/json',
    contentType => contentType === 'application/json' || contentType.endsWith('+json'),
    'Source did not return JSON'
  );
  return async (inputUrl: URL, headers: Record<string, string> = {}): Promise<HttpJsonResponse> => {
    const response = await requestBody(inputUrl, headers);
    if (response.status === 304) {
      return {
        status: 304,
        data: null,
        etag: response.etag,
        lastModified: response.lastModified,
      };
    }
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder().decode(response.body as Uint8Array));
    } catch {
      throw requestError('invalid_json', 'Source returned invalid JSON');
    }
    return {
      status: 200,
      data,
      etag: response.etag,
      lastModified: response.lastModified,
    };
  };
};

export const createHttpBinaryClient = (options: HttpBinaryClientOptions) => {
  const allowedContentTypes = new Set(
    options.allowedContentTypes.map(contentType => contentType.trim().toLowerCase())
  );
  const requestBody = createHttpBodyClient(
    options,
    options.allowedContentTypes.join(','),
    contentType => allowedContentTypes.has(contentType),
    'Source did not return an allowed binary content type'
  );
  return async (
    inputUrl: URL,
    headers: Record<string, string> = {}
  ): Promise<HttpBinaryResponse> => {
    const response = await requestBody(inputUrl, headers);
    return {
      status: response.status,
      data: response.body,
      contentType: response.contentType,
      etag: response.etag,
      lastModified: response.lastModified,
      finalUrl: response.finalUrl,
    };
  };
};

export const createCachedSourceRequester = (
  database: Database.Database,
  sourceId: string,
  requestJson = createHttpJsonClient()
): SourceJsonRequester => ({
  request: async <T>(
    url: URL,
    resourceKey: string,
    schema: z.ZodType<T>,
    options?: { headers?: Record<string, string> }
  ) => {
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
    const headers: Record<string, string> = { ...options?.headers };
    const authenticated = Object.keys(headers).some(name =>
      ['authorization', 'cookie', 'proxy-authorization'].includes(name.toLowerCase())
    );
    if (!authenticated && cached?.etag) headers['If-None-Match'] = cached.etag;
    if (!authenticated && cached?.last_modified) {
      headers['If-Modified-Since'] = cached.last_modified;
    }

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

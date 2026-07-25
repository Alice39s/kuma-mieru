import { createHash } from 'node:crypto';
import { createHttpBinaryClient, type HttpBinaryResponse } from '../adapters/http-client.js';

const allowedIconContentTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
] as const;

type BinaryRequester = (url: URL, headers?: Record<string, string>) => Promise<HttpBinaryResponse>;

export interface IconProxyResult {
  bytes: Uint8Array;
  contentType: (typeof allowedIconContentTypes)[number];
  etag: string;
}

export interface IconProxyService {
  fetch(input: { icon: string; sourceBaseUrl: string }): Promise<IconProxyResult | null>;
}

export interface CreateIconProxyServiceOptions {
  privateAddressCidrs?: readonly string[];
  requesterForOrigin?: (origin: string) => BinaryRequester;
}

const normalizeIcon = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  if (!quoted || trimmed.length < 2) return trimmed;
  return trimmed.slice(1, -1).trim() || null;
};

export const resolveIconTarget = (input: { icon: string; sourceBaseUrl: string }) => {
  const icon = normalizeIcon(input.icon);
  if (!icon || icon === '/icon.svg' || icon.startsWith('data:') || icon.startsWith('//')) {
    return null;
  }
  const base = new URL(input.sourceBaseUrl);
  base.hash = '';
  base.search = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const target = new URL(icon, base);
  if (target.origin !== base.origin || target.hash) return null;
  return target;
};

export const createIconProxyService = ({
  privateAddressCidrs = [],
  requesterForOrigin,
}: CreateIconProxyServiceOptions = {}): IconProxyService => ({
  fetch: async input => {
    const target = resolveIconTarget(input);
    if (!target) return null;
    const requester =
      requesterForOrigin?.(target.origin) ??
      createHttpBinaryClient({
        privateAddressCidrs,
        allowedOrigins: [target.origin],
        allowedContentTypes: allowedIconContentTypes,
        timeoutMs: 10_000,
        maxBodyBytes: 2 * 1024 * 1024,
        maxRedirects: 3,
      });
    const response = await requester(target);
    if (
      response.status !== 200 ||
      !response.data ||
      !response.contentType ||
      !allowedIconContentTypes.includes(
        response.contentType as (typeof allowedIconContentTypes)[number]
      )
    ) {
      return null;
    }
    return {
      bytes: response.data,
      contentType: response.contentType as (typeof allowedIconContentTypes)[number],
      etag: `"${createHash('sha256').update(response.data).digest('base64url')}"`,
    };
  },
});

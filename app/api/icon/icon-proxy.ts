import { normalizeBaseUrl } from '@/utils/url';
import { createIntegerStringSchema } from '@/utils/number-schema';
import { z } from 'zod';

const FALLBACK_ICON = '/icon.svg';
const iconValueSchema = z.string();
const absoluteHttpUrlSchema = z.url().refine(value => /^https?:\/\//i.test(value));
const contentLengthSchema = createIntegerStringSchema({ min: 0 });

export function normalizeIconValue(icon: unknown): string | null {
  const parsedIcon = iconValueSchema.safeParse(icon);
  if (!parsedIcon.success) return null;

  const trimmed = parsedIcon.data.trim();
  if (!trimmed) return null;

  const isWrappedByDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
  const isWrappedBySingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'");

  if ((isWrappedByDoubleQuotes || isWrappedBySingleQuotes) && trimmed.length >= 2) {
    const unwrapped = trimmed.slice(1, -1).trim();
    return unwrapped || null;
  }

  return trimmed;
}

export function resolveUpstreamIconUrl(icon: string, baseUrl: string): string | null {
  if (!icon || icon === FALLBACK_ICON || icon.startsWith('data:')) return null;

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const baseOrigin = new URL(normalizedBaseUrl).origin;

  if (/^https?:\/\//i.test(icon)) {
    const parsedIcon = absoluteHttpUrlSchema.safeParse(icon);
    if (!parsedIcon.success) return null;

    const parsed = new URL(parsedIcon.data);
    if (parsed.origin !== baseOrigin) return null;
    return parsed.toString();
  }

  if (icon.startsWith('//')) return null;

  return `${normalizedBaseUrl}/${icon.replace(/^\/+/, '')}`;
}

export function isProxyableIconContentType(contentType: string): boolean {
  const mimeType = contentType.split(';', 1)[0].trim().toLowerCase();

  return mimeType.startsWith('image/') && mimeType !== 'image/svg+xml';
}

export function parseIconContentLength(contentLength: string | undefined): number | null {
  const parsed = contentLengthSchema.safeParse(contentLength);
  return parsed.success ? parsed.data : null;
}

import { z } from 'zod';

const optionalHeaderValueSchema = z.union([
  z.undefined().transform(() => null),
  z.unknown().transform(value => String(value)),
]);

const requestHeaderEntriesSchema = z.union([
  z.instanceof(Headers).transform(headers => Array.from(headers.entries())),
  z.array(z.tuple([z.string(), z.unknown()])),
  z.record(z.string(), z.unknown()).transform(headers => Object.entries(headers)),
]);

const nodeResponseHeaderValueSchema = z.union([
  z.array(z.string()).transform(value => value.join(', ')),
  z.undefined().transform(() => ''),
  z.unknown().transform(value => String(value)),
]);

export function normalizeRequestHeaders(headers?: unknown): Record<string, string> {
  if (!headers) {
    return {};
  }

  const normalizedHeaders = new Headers();
  const entries = requestHeaderEntriesSchema.parse(headers);

  for (const [key, value] of entries) {
    const normalizedValue = optionalHeaderValueSchema.parse(value);
    if (normalizedValue !== null) {
      normalizedHeaders.append(key, normalizedValue);
    }
  }

  return Object.fromEntries(normalizedHeaders.entries());
}

export function normalizeNodeResponseHeaders(
  headers: Record<string, unknown>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, nodeResponseHeaderValueSchema.parse(value)])
  );
}

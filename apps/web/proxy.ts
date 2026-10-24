import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

function normalizeAllowEmbedding(value: string | undefined): string {
  return value?.trim() ?? '';
}

function toFrameAncestors(allowEmbedding: string): string | null {
  if (!allowEmbedding || allowEmbedding === 'false') return null;
  if (allowEmbedding === 'true') return "frame-ancestors 'self' *;";

  const origins = allowEmbedding
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
    .map(origin => (origin.startsWith('http') ? origin : `https://${origin}`));

  if (origins.length === 0) return null;

  return `frame-ancestors 'self' ${origins.join(' ')};`;
}

export function proxy(_request: NextRequest) {
  const response = NextResponse.next();
  const allowEmbedding = normalizeAllowEmbedding(process.env.ALLOW_EMBEDDING);
  const frameAncestors = toFrameAncestors(allowEmbedding);

  if (!frameAncestors) {
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
    response.headers.delete('Content-Security-Policy');
    return response;
  }

  response.headers.delete('X-Frame-Options');
  response.headers.set('Content-Security-Policy', frameAncestors);

  return response;
}

export const config = {
  matcher: '/:path*',
};

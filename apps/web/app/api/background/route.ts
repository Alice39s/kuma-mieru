import { env } from '@/config/env';
import { createBackgroundSource } from '@/services/background.server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const { backgroundSource, backgroundQuery, backgroundRefreshSeconds } = env.config.appearance;
const source =
  backgroundSource === 'custom'
    ? null
    : createBackgroundSource({
        source: backgroundSource,
        query: backgroundQuery,
        refreshSeconds: backgroundRefreshSeconds,
        accessKey:
          (backgroundSource === 'unsplash'
            ? process.env.UNSPLASH_ACCESS_KEY
            : process.env.PEXELS_API_KEY) ?? '',
      });

export async function GET() {
  if (!source) return new NextResponse(null, { status: 204 });

  try {
    const { photo, expiresAt } = await source.getPhoto();
    const remaining = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
    return NextResponse.json(photo, {
      headers: {
        'Cache-Control': `public, max-age=60, s-maxage=${remaining}, stale-while-revalidate=60`,
      },
    });
  } catch (error) {
    console.error('Failed to sync background photo', {
      source: backgroundSource,
      error: error instanceof Error ? error.message : 'Invalid provider response',
    });
    return NextResponse.json(
      { error: 'Background source is unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } }
    );
  }
}

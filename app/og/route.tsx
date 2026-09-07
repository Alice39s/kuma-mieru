import { getOpenGraphData } from '@/app/lib/open-graph';
import { OpenGraphImage } from '@/components/open-graph/image';
import { getConfig } from '@/config/api';
import { createInFlightLoader } from '@/services/utils/in-flight';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LRUCache } from 'lru-cache';
import { ImageResponse } from 'takumi-js/response';
import {
  integer,
  minValue,
  object,
  optional,
  picklist,
  pipe,
  safeParse,
  string,
  transform,
} from 'valibot';

export const runtime = 'nodejs';

const querySchema = object({
  pageId: optional(string()),
  monitorId: optional(pipe(string(), transform(Number), integer(), minValue(1))),
  view: optional(picklist(['status', 'about']), 'status'),
});
interface CachedImage {
  bytes: Uint8Array<ArrayBuffer>;
  isAvailable: boolean;
}
const images = new LRUCache<string, CachedImage>({
  maxSize: 8 * 1024 * 1024,
  sizeCalculation: image => image.bytes.byteLength,
  ttl: 60_000,
});
const loadImage = createInFlightLoader<string, CachedImage | null>();
const fonts = [
  {
    name: 'Noto Sans CJK SC',
    data: () => readFile(join(process.cwd(), 'assets/og/NotoSansCJKsc-Regular.otf')),
  },
];

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = safeParse(querySchema, {
    pageId: params.get('pageId') ?? undefined,
    monitorId: params.get('monitorId') ?? undefined,
    view: params.get('view') ?? undefined,
  });
  if (!query.success)
    return new Response('Invalid image parameters', {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  const { pageId, monitorId, view } = query.output;
  const config = getConfig(pageId);
  if (!config)
    return new Response('Status page not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  const key = JSON.stringify([config.pageId, monitorId, view]);
  try {
    const image =
      images.get(key) ??
      (await loadImage(key, async () => {
        const data = await getOpenGraphData(config.pageId, monitorId, view === 'about');
        if (!data) return null;
        const logo = `data:image/svg+xml;base64,${(await readFile(join(process.cwd(), 'public/icon.svg'))).toString('base64')}`;
        const response = new ImageResponse(<OpenGraphImage data={data} logo={logo} />, {
          width: 1200,
          height: 630,
          format: 'png',
          fonts,
        });
        await response.ready;
        const image = {
          bytes: new Uint8Array(await response.arrayBuffer()),
          isAvailable: data.isAvailable,
        };
        if (image.isAvailable) images.set(key, image);
        return image;
      }));
    if (!image)
      return new Response('Monitor not found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    return new Response(image.bytes, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': image.isAvailable
          ? 'public, max-age=60, s-maxage=60, stale-while-revalidate=300'
          : 'no-store',
      },
    });
  } catch (error) {
    console.error('Failed to render OpenGraph image', { pageId: config.pageId, monitorId, error });
    return new Response('Image generation failed', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

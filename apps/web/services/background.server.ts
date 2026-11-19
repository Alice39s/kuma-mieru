import { array, minLength, object, parse, pipe } from 'valibot';
import { parsePexelsPhoto, parseUnsplashPhoto, pexelsPhotoSchema } from '../config/background';
import type { BackgroundPhoto } from '../config/background';

interface BackgroundSourceOptions {
  source: 'unsplash' | 'pexels';
  query: string;
  refreshSeconds: number;
  accessKey: string;
}

interface CachedBackground {
  photo: BackgroundPhoto;
  expiresAt: number;
}

const pexelsResponseSchema = object({ photos: pipe(array(pexelsPhotoSchema), minLength(1)) });

export function createBackgroundSource(
  options: BackgroundSourceOptions,
  fetcher: typeof fetch = fetch,
  clock = Date.now
) {
  const ttl = Math.max(options.refreshSeconds, 900) * 1000;
  let cached: CachedBackground | undefined;
  let pending: Promise<CachedBackground> | undefined;
  let retryAt = 0;

  async function request(url: URL | string) {
    const response = await fetcher(url, {
      headers: {
        Authorization:
          options.source === 'unsplash' ? `Client-ID ${options.accessKey}` : options.accessKey,
        Accept: 'application/json',
        ...(options.source === 'unsplash' ? { 'Accept-Version': 'v1' } : {}),
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`${options.source} background request returned HTTP ${response.status}`);
    }
    return response;
  }

  async function load(): Promise<BackgroundPhoto> {
    if (!options.accessKey) {
      throw new Error(`Missing API key for ${options.source} backgrounds`);
    }

    if (options.source === 'unsplash') {
      const endpoint = new URL('https://api.unsplash.com/photos/random');
      endpoint.search = new URLSearchParams({
        query: options.query,
        orientation: 'landscape',
        content_filter: 'high',
      }).toString();
      const response = await request(endpoint);
      const result = parseUnsplashPhoto(await response.json());
      // Selecting an image as a wallpaper is a download-like action in the Unsplash guidelines.
      const tracked = await request(result.downloadUrl);
      await tracked.body?.cancel();
      return result.photo;
    }

    const endpoint = new URL('https://api.pexels.com/v1/search');
    endpoint.search = new URLSearchParams({
      query: options.query,
      orientation: 'landscape',
      per_page: '30',
    }).toString();
    const response = await request(endpoint);
    const { photos } = parse(pexelsResponseSchema, await response.json());
    return parsePexelsPhoto(photos[Math.floor(clock() / ttl) % photos.length]);
  }

  function getPhoto(): Promise<CachedBackground> {
    const now = clock();
    if (cached && now < cached.expiresAt) return Promise.resolve(cached);
    if (pending) return pending;
    if (now < retryAt) {
      if (cached) return Promise.resolve({ ...cached, expiresAt: retryAt });
      return Promise.reject(new Error(`${options.source} background retry is delayed`));
    }

    pending = load()
      .then(photo => {
        cached = { photo, expiresAt: clock() + ttl };
        retryAt = 0;
        return cached;
      })
      .catch((error: unknown) => {
        retryAt = clock() + 60000;
        if (!cached) throw error;
        console.warn('Background sync failed; keeping the previous photo', {
          source: options.source,
          error: error instanceof Error ? error.message : 'Invalid provider response',
        });
        return { ...cached, expiresAt: retryAt };
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }

  return { getPhoto };
}

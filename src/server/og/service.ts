import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { renderOgImage } from './render.js';
import type { OgImageInput, OgImageResult, OgImageService } from './types.js';

interface OgImageServiceOptions {
  fallbackPath: string;
  maximumEntries?: number;
  maximumConcurrentRenders?: number;
  renderTimeoutMs?: number;
  renderImage?: (input: OgImageInput, signal?: AbortSignal) => Promise<Buffer>;
}

const digest = (bytes: Buffer) => `"${createHash('sha256').update(bytes).digest('base64url')}"`;
const keyFor = (input: OgImageInput) =>
  createHash('sha256').update(JSON.stringify(input), 'utf8').digest('base64url');

export const createOgImageService = ({
  fallbackPath,
  maximumEntries = 128,
  maximumConcurrentRenders = 2,
  renderTimeoutMs = 5_000,
  renderImage = renderOgImage,
}: OgImageServiceOptions): OgImageService => {
  const cache = new Map<string, Omit<OgImageResult, 'source'>>();
  const inFlight = new Map<string, Promise<OgImageResult>>();
  let fallbackPromise: Promise<Buffer> | null = null;

  const fallback = () => {
    fallbackPromise ??= readFile(fallbackPath);
    return fallbackPromise;
  };

  const render = async (input: OgImageInput): Promise<OgImageResult> => {
    const key = keyFor(input);
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return { ...cached, source: 'memory' };
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
    if (inFlight.size >= maximumConcurrentRenders) {
      const bytes = await fallback();
      return { bytes, etag: digest(bytes), source: 'fallback' };
    }

    const task = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error('OG image rendering exceeded its time limit')),
        renderTimeoutMs
      );
      try {
        const bytes = await renderImage(input, controller.signal);
        const result = { bytes, etag: digest(bytes) };
        cache.set(key, result);
        while (cache.size > maximumEntries) {
          const oldest = cache.keys().next().value as string | undefined;
          if (!oldest) break;
          cache.delete(oldest);
        }
        return { ...result, source: 'rendered' as const };
      } catch (error) {
        console.warn('OG image rendering failed; serving static fallback', {
          message: error instanceof Error ? error.message : 'unknown error',
          pageId: input.pageId,
          view: input.view,
        });
        const bytes = await fallback();
        return { bytes, etag: digest(bytes), source: 'fallback' as const };
      } finally {
        clearTimeout(timeout);
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, task);
    return task;
  };

  return { render };
};

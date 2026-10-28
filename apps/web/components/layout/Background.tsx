'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { parse } from 'valibot';
import { backgroundPhotoSchema } from '@/config/background';
import type { BackgroundPhoto } from '@/config/background';
import { usePageConfig } from '../context/PageConfigContext';

interface BackgroundImage {
  url: string;
  photo?: BackgroundPhoto;
}

async function fetchBackground(url: string): Promise<BackgroundPhoto> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Background sync returned HTTP ${response.status}`);
  return parse(backgroundPhotoSchema, await response.json());
}

export function useBackground() {
  const { appearance } = usePageConfig();
  const { backgroundSource, backgroundImage, backgroundRefreshSeconds } = appearance;
  const [image, setImage] = useState<BackgroundImage>(() => ({
    url: backgroundImage || (backgroundSource === 'custom' ? '' : '/backgrounds/alpine-lake.webp'),
  }));
  const { data } = useSWR(
    backgroundSource === 'custom' ? null : '/api/background',
    fetchBackground,
    {
      refreshInterval: backgroundRefreshSeconds
        ? Math.max(backgroundRefreshSeconds, 900) * 1000
        : 0,
      revalidateOnFocus: false,
      dedupingInterval: 60000,
      errorRetryInterval: 60000,
      errorRetryCount: 2,
      keepPreviousData: true,
    }
  );

  useEffect(() => {
    if (!data) return;
    const preload = new Image();
    preload.onload = () => setImage({ url: data.url, photo: data });
    preload.src = data.url;
    return () => {
      preload.onload = null;
    };
  }, [data]);

  useEffect(() => {
    if (backgroundSource !== 'custom' || !backgroundImage || !backgroundRefreshSeconds) return;
    let preload: HTMLImageElement | undefined;
    let lastSync = Date.now();
    const interval = Math.max(backgroundRefreshSeconds, 900) * 1000;
    const refresh = () => {
      if (document.hidden || Date.now() - lastSync < interval) return;
      lastSync = Date.now();
      if (preload) preload.onload = null;
      const refreshed = new URL(backgroundImage, window.location.origin);
      refreshed.searchParams.set('_kuma_bg', String(Math.floor(Date.now() / 1000)));
      preload = new Image();
      preload.onload = () => setImage({ url: refreshed.href });
      preload.src = refreshed.href;
    };
    const timer = window.setInterval(refresh, interval);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      if (preload) preload.onload = null;
    };
  }, [backgroundSource, backgroundImage, backgroundRefreshSeconds]);

  return image;
}

export function Background({ image }: { image: BackgroundImage }) {
  const reducedMotion = useReducedMotion();
  if (!image.url) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
      <AnimatePresence initial={false}>
        <motion.div
          key={image.url}
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${JSON.stringify(image.url)})` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.6 }}
        />
      </AnimatePresence>
      <div className="absolute inset-0 bg-white/35 dark:bg-slate-950/45" />
    </div>
  );
}

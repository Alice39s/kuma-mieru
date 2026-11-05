'use client';

import type { SiteConfig } from '@/types/config';
import { Link } from '@heroui/react';

import packageJson from '@/package.json';
import type { BackgroundPhoto } from '@/config/background';

interface FooterProps {
  config?: SiteConfig;
  backgroundPhoto?: BackgroundPhoto;
}

export function Footer({ config, backgroundPhoto }: FooterProps) {
  const footerConfig = config;

  const footerText = footerConfig?.footerText ?? '';
  const showPoweredBy = footerConfig?.showPoweredBy ?? false;

  return (
    <footer className="w-full flex flex-col items-center justify-center py-4 px-4 mt-4 text-sm text-foreground-500 relative z-50">
      <div className="container mx-auto flex flex-col md:flex-row items-center justify-between">
        <div className="mb-2 md:mb-0 text-base">{footerText}</div>

        <div className="flex items-center gap-1 text-xs">
          <span>Powered by</span>
          {showPoweredBy ? (
            <>
              <Link
                href="https://github.com/louislam/uptime-kuma"
                isExternal
                className="text-primary text-xs"
              >
                Uptime Kuma
              </Link>
              <span>&</span>
              <Link
                href="https://github.com/alice39s/kuma-mieru"
                isExternal
                className="text-primary text-xs"
              >
                Kuma Mieru v{packageJson.version}
              </Link>
            </>
          ) : (
            <>
              <span>Uptime Kuma</span>
              <span>&</span>
              <span>Kuma Mieru v{packageJson.version}</span>
            </>
          )}
        </div>
      </div>
      {backgroundPhoto ? (
        <p className="mt-2 text-xs text-foreground">
          Photo by{' '}
          <a
            href={backgroundPhoto.photographerUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {backgroundPhoto.photographer}
          </a>{' '}
          on{' '}
          <a
            href={backgroundPhoto.photoUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {backgroundPhoto.source === 'unsplash' ? 'Unsplash' : 'Pexels'}
          </a>
        </p>
      ) : null}
    </footer>
  );
}

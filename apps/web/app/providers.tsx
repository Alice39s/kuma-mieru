'use client';

/**
 * Copyright (c) 2025-present, Source: https://github.com/Alice39s/kuma-mieru
 * Under the MPL-2.0 License, see ../LICENSE for more details.
 * PLEASE DO NOT REMOVE THIS HEADER.
 */

import type { ThemeProviderProps } from 'next-themes';

import { NodeSearchProvider } from '@/components/context/NodeSearchContext';
import { HeroUIProvider } from '@heroui/react';
import type { AbstractIntlMessages } from 'next-intl';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { useRouter } from 'next/navigation';
import type * as React from 'react';

export interface ProvidersProps {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
  locale: string;
  messages: AbstractIntlMessages;
}

declare module '@react-types/shared' {
  interface RouterConfig {
    routerOptions: NonNullable<Parameters<ReturnType<typeof useRouter>['push']>[1]>;
  }
}

export function Providers({ children, themeProps, locale, messages }: ProvidersProps) {
  const router = useRouter();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      <HeroUIProvider navigate={router.push}>
        <NextThemesProvider {...themeProps}>
          <NodeSearchProvider>{children}</NodeSearchProvider>
        </NextThemesProvider>
      </HeroUIProvider>
    </NextIntlClientProvider>
  );
}

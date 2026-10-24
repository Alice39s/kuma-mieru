import { getRequestConfig } from 'next-intl/server';
import { defaultLocale } from './config';
import { getUserLocale } from './locale';

export default getRequestConfig(async () => {
  const locale = (await getUserLocale()) || defaultLocale;
  let messages: Record<string, unknown>;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    console.warn(
      `[i18n] Locale file for "${locale}" not found, falling back to "${defaultLocale}"`
    );
    messages = (await import(`../../messages/${defaultLocale}.json`)).default;
  }
  return {
    locale,
    formats: {
      dateTime: {
        normal: {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
        },
      },
    },
    messages,
  };
});

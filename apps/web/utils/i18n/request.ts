import { getRequestConfig } from 'next-intl/server';
import { defaultLocale } from './config';
import { getUserLocale } from './locale';
import { hasMessages, loadMessages } from './messages';

export default getRequestConfig(async () => {
  const locale = (await getUserLocale()) || defaultLocale;
  if (!hasMessages(locale)) {
    console.warn(
      `[i18n] Locale file for "${locale}" not found, falling back to "${defaultLocale}"`
    );
  }
  const messages = await loadMessages(hasMessages(locale) ? locale : defaultLocale);
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

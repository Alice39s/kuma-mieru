'use server';

import { cookies, headers } from 'next/headers';
import { type Locale, defaultLocale } from './config';
import { resolveLocaleFromCandidates } from './resolve-locale';

const COOKIE_NAME = 'Next_i18n';

export const getUserLocale = async () => {
  // First check if locale is stored in cookie
  if ((await cookies()).get(COOKIE_NAME)?.value) {
    return (await cookies()).get(COOKIE_NAME)?.value;
  }

  const acceptLang = (await headers()).get('Accept-Language');
  if (!acceptLang) return defaultLocale;

  const languages = acceptLang.split(',').map(lang => {
    const [languageCode] = lang.split(';');
    return languageCode.trim();
  });

  return resolveLocaleFromCandidates(languages);
};

export const setUserLocale = async (locale: Locale) => {
  (await cookies()).set(COOKIE_NAME, locale);
};

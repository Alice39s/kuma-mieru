'use server';

import { cookies, headers } from 'next/headers';
import { type Locale, defaultLocale, locales } from './config';

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

  const validLocales = new Set(locales.map(locale => locale.key));

  // First try exact-match
  const exactMatch = languages.find(lang => validLocales.has(lang as Locale));
  if (exactMatch) return exactMatch;

  // If no exact match, try matching language base
  for (const lang of languages) {
    const baseLanguage = lang.split('-')[0]; // Get base language (e.g., 'en' from 'en-US')

    // Find first locale that starts with the base language
    const matchingLocale = Array.from(validLocales).find(
      validLocale => validLocale.startsWith(`${baseLanguage}-`) || validLocale === baseLanguage
    );

    if (matchingLocale) return matchingLocale;
  }

  return defaultLocale;
};

export const setUserLocale = async (locale: Locale) => {
  (await cookies()).set(COOKIE_NAME, locale);
};

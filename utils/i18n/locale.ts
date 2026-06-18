'use server';

import { cookies, headers } from 'next/headers';
import type { Locale } from './config';
import { parseLocale } from './locale-schema';
import { resolveUserLocale } from './user-locale';

const COOKIE_NAME = 'Next_i18n';

export const getUserLocale = async () => {
  const cookieStore = await cookies();
  const headersList = await headers();
  const cookieLocale = cookieStore.get(COOKIE_NAME)?.value;
  const acceptLanguage = headersList.get('Accept-Language');

  return resolveUserLocale(cookieLocale, acceptLanguage);
};

export const setUserLocale = async (locale: Locale) => {
  const parsedLocale = parseLocale(locale);
  (await cookies()).set(COOKIE_NAME, parsedLocale);
};

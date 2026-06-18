import { z } from 'zod';
import { type Locale, locales } from './config';

const localeKeys = locales.map(locale => locale.key) as [Locale, ...Locale[]];

export const localeSchema = z.enum(localeKeys);

export function parseLocale(locale: unknown): Locale {
  return localeSchema.parse(locale);
}

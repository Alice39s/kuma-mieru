import { type Locale, defaultLocale, locales } from './config';

const validLocales = new Set(locales.map(locale => locale.key));

export function resolveLocaleFromCandidates(candidates: readonly string[]): Locale {
  const normalizedCandidates = candidates
    .map(candidate => candidate.trim())
    .filter(candidate => candidate.length > 0);

  const exactMatch = normalizedCandidates.find(candidate => validLocales.has(candidate as Locale));
  if (exactMatch) {
    return exactMatch as Locale;
  }

  for (const candidate of normalizedCandidates) {
    const baseLanguage = candidate.split('-')[0];
    const matchingLocale = Array.from(validLocales).find(
      validLocale => validLocale.startsWith(`${baseLanguage}-`) || validLocale === baseLanguage
    );

    if (matchingLocale) {
      return matchingLocale;
    }
  }

  return defaultLocale;
}

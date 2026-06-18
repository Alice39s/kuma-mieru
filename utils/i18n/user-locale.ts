import { type Locale, defaultLocale } from './config';
import { resolveLocaleFromCandidates } from './resolve-locale';
import { z } from 'zod';

const acceptLanguageQValueSchema = z.coerce.number().min(0).max(1).catch(0);

const acceptLanguageItemSchema = z
  .string()
  .transform(item => {
    const [languageCodeRaw = '', ...parameters] = item.split(';');
    const qParameter = parameters.find(parameter => parameter.trim().startsWith('q='));

    return {
      languageCode: languageCodeRaw.trim(),
      q: qParameter ? acceptLanguageQValueSchema.parse(qParameter.split('=')[1]?.trim()) : 1,
    };
  })
  .pipe(
    z.object({
      languageCode: z.string().min(1),
      q: z.number().min(0).max(1),
    })
  )
  .optional()
  .catch(undefined);

function parseAcceptLanguageHeader(acceptLanguage: string | null | undefined): string[] {
  const items = z
    .array(acceptLanguageItemSchema)
    .parse(acceptLanguage?.split(',') ?? [])
    .filter(item => item !== undefined)
    .filter(item => item.q > 0)
    .sort((a, b) => b.q - a.q);

  return items.map(item => item.languageCode);
}

export function resolveUserLocale(
  cookieLocale: string | null | undefined,
  acceptLanguage: string | null | undefined
): Locale {
  const locale = resolveLocaleFromCandidates([
    cookieLocale ?? '',
    ...parseAcceptLanguageHeader(acceptLanguage),
  ]);

  return locale || defaultLocale;
}

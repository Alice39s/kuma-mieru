import { z } from 'zod';

export type HtmlEntityMap = Record<string, string>;

export const defaultHtmlEntities: HtmlEntityMap = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' ',
  '&copy;': '\u00a9',
  '&reg;': '\u00ae',
  '&trade;': '\u2122',
  '&mdash;': '\u2014',
  '&ndash;': '\u2013',
  '&hellip;': '\u2026',
  '&laquo;': '\u00ab',
  '&raquo;': '\u00bb',
};

const htmlEntityCodePointSchema = z.number().int().min(0).max(0x10ffff);
const coercedHtmlEntityCodePointSchema = z.coerce.number().pipe(htmlEntityCodePointSchema);

export function decodeHtmlEntityCodePoint(raw: string, radix: 10 | 16): string | null {
  const parsed = coercedHtmlEntityCodePointSchema.safeParse(radix === 16 ? `0x${raw}` : raw);

  return parsed.success ? String.fromCodePoint(parsed.data) : null;
}

export function decodeHtmlEntities(
  value: string,
  entities: HtmlEntityMap = defaultHtmlEntities
): string {
  return value.replace(/&(?:[a-zA-Z][a-zA-Z0-9]+|#\d+|#x[0-9a-fA-F]+);/g, match => {
    const decimalMatch = match.match(/^&#(\d+);$/);
    if (decimalMatch?.[1]) {
      return decodeHtmlEntityCodePoint(decimalMatch[1], 10) ?? match;
    }

    const hexMatch = match.match(/^&#x([0-9a-fA-F]+);$/);
    if (hexMatch?.[1]) {
      return decodeHtmlEntityCodePoint(hexMatch[1], 16) ?? match;
    }

    return entities[match] ?? match;
  });
}

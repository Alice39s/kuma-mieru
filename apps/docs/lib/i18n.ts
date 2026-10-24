import { defineI18n } from 'fumadocs-core/i18n';

/**
 * Chinese is the primary language. Every URL carries its locale (`/zh/…`, `/en/…`) because a static export has no
 * server to rewrite prefix-less paths. A page without an English file falls back to the Chinese page.
 */
export const i18n = defineI18n({
  defaultLanguage: 'zh',
  languages: ['zh', 'en'],
  hideLocale: 'never',
  parser: 'dot',
});

export type Locale = (typeof i18n.languages)[number];

/** BCP 47 tags for `<html lang>`, `hreflang` and Open Graph. */
export const htmlLang = {
  zh: 'zh-CN',
  en: 'en',
} as const satisfies Record<Locale, string>;

export function isLocale(value: string): value is Locale {
  return i18n.languages.some(language => language === value);
}

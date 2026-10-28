import {
  array,
  boolean,
  check,
  minLength,
  maxValue,
  minValue,
  integer,
  number,
  object,
  optional,
  parseJson,
  picklist,
  pipe,
  string,
  trim,
  url,
} from 'valibot';
import type { InferOutput } from 'valibot';

export const siteMetaSchema = object({
  title: string(),
  description: string(),
  icon: string(),
  iconCandidates: pipe(array(string()), minLength(1)),
});

export const generatedPageConfigSchema = object({
  id: string(),
  baseUrl: pipe(string(), url()),
  siteMeta: siteMetaSchema,
});

export const appearanceSchema = object({
  backgroundImage: optional(
    pipe(
      string(),
      trim(),
      check(value => {
        if (value === '') return true;
        if (Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
          return false;
        }
        if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) {
          return true;
        }
        return URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol);
      }, 'Background image must be an HTTP(S) URL or a path starting with a single /')
    ),
    ''
  ),
  glassCards: optional(boolean(), false),
  backgroundSource: optional(picklist(['custom', 'unsplash', 'pexels']), 'custom'),
  backgroundQuery: optional(pipe(string(), trim(), minLength(1)), 'nature landscape'),
  backgroundRefreshSeconds: optional(
    pipe(
      number(),
      integer(),
      minValue(0),
      maxValue(86400),
      check(value => value === 0 || value >= 900)
    ),
    21600
  ),
});

export const generatedConfigSchema = object({
  /** Default base URL (first page's base URL). Used as fallback when a page has no explicit baseUrl. */
  baseUrl: pipe(string(), url()),
  pageId: string(),
  pageIds: pipe(array(string()), minLength(1)),
  pages: pipe(array(generatedPageConfigSchema), minLength(1)),
  siteMeta: siteMetaSchema,
  isPlaceholder: boolean(),
  isEditThisPage: boolean(),
  isShowStarButton: boolean(),
  appearance: optional(appearanceSchema, {}),
});

/** Raw contents of `config/generated-config.json`, parsed and validated in one step. */
export const generatedConfigFileSchema = pipe(string(), parseJson(), generatedConfigSchema);

export type SiteMeta = InferOutput<typeof siteMetaSchema>;

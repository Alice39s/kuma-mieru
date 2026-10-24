import { array, boolean, minLength, object, parseJson, pipe, string, url } from 'valibot';
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
});

/** Raw contents of `config/generated-config.json`, parsed and validated in one step. */
export const generatedConfigFileSchema = pipe(string(), parseJson(), generatedConfigSchema);

export type SiteMeta = InferOutput<typeof siteMetaSchema>;

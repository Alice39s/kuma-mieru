import { array, boolean, check, minLength, object, pipe, string, trim } from 'valibot';
import type { InferOutput } from 'valibot';

const absoluteUrlSchema = pipe(
  string(),
  trim(),
  check(value => URL.canParse(value), 'Invalid URL')
);

export const siteMetaSchema = object({
  title: string(),
  description: string(),
  icon: string(),
  iconCandidates: pipe(array(string()), minLength(1)),
});

export const generatedPageConfigSchema = object({
  id: string(),
  baseUrl: absoluteUrlSchema,
  siteMeta: siteMetaSchema,
});

export const generatedConfigSchema = object({
  baseUrl: absoluteUrlSchema,
  pageId: string(),
  pageIds: pipe(array(string()), minLength(1)),
  pages: pipe(array(generatedPageConfigSchema), minLength(1)),
  siteMeta: siteMetaSchema,
  isPlaceholder: boolean(),
  isEditThisPage: boolean(),
  isShowStarButton: boolean(),
});

export type SiteMeta = InferOutput<typeof siteMetaSchema>;

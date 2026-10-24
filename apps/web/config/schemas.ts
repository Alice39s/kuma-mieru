import { z } from 'zod';

export const siteMetaSchema = z.object({
  title: z.string(),
  description: z.string(),
  icon: z.string(),
  iconCandidates: z.array(z.string()).min(1),
});

export const generatedPageConfigSchema = z.object({
  id: z.string(),
  baseUrl: z.url(),
  siteMeta: siteMetaSchema,
});

export const generatedConfigSchema = z.object({
  baseUrl: z.url(),
  pageId: z.string(),
  pageIds: z.array(z.string()).min(1),
  pages: z.array(generatedPageConfigSchema).min(1),
  siteMeta: siteMetaSchema,
  isPlaceholder: z.boolean(),
  isEditThisPage: z.boolean(),
  isShowStarButton: z.boolean(),
});

export type SiteMeta = z.infer<typeof siteMetaSchema>;

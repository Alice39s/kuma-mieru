import { z } from 'zod';

export const configModeSchema = z.enum(['compatibility', 'managed', 'file']);

export const sourceSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('uptime-kuma'),
  baseUrl: z.string().url(),
  pageIds: z.array(z.string().min(1)).min(1),
});

export const statusPageSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  sourceRefs: z.array(z.string().min(1)).min(1),
});

export const canonicalConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    server: z
      .object({
        publicBaseUrl: z.string().url().optional(),
      })
      .default({}),
    sources: z.array(sourceSchema),
    pages: z.array(statusPageSchema),
  })
  .superRefine((config, context) => {
    const sourceIds = new Set<string>();
    config.sources.forEach((source, index) => {
      if (sourceIds.has(source.id)) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'id'],
          message: `Duplicate source id: ${source.id}`,
        });
      }
      sourceIds.add(source.id);
    });

    const pageIds = new Set<string>();
    const pageSlugs = new Set<string>();
    config.pages.forEach((page, index) => {
      if (pageIds.has(page.id)) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'id'],
          message: `Duplicate page id: ${page.id}`,
        });
      }
      if (pageSlugs.has(page.slug)) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'slug'],
          message: `Duplicate page slug: ${page.slug}`,
        });
      }
      page.sourceRefs.forEach((sourceRef, sourceRefIndex) => {
        if (!sourceIds.has(sourceRef)) {
          context.addIssue({
            code: 'custom',
            path: ['pages', index, 'sourceRefs', sourceRefIndex],
            message: `Unknown source reference: ${sourceRef}`,
          });
        }
      });
      pageIds.add(page.id);
      pageSlugs.add(page.slug);
    });
  });

export type ConfigMode = z.infer<typeof configModeSchema>;
export type CanonicalConfig = z.infer<typeof canonicalConfigSchema>;

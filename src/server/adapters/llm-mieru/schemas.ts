import { z } from 'zod';
import { methodologySnapshotSchema } from '../types.js';

export const llmMieruMetaSchema = z.object({
  apiVersion: z.string(),
  schemaVersion: z.string(),
  instanceId: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  protocolVersions: z.array(z.string()),
  features: z.array(z.string()),
});

export const llmMieruServicesSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      providerRoute: z.string().min(1),
      requestedModel: z.string().min(1),
      status: z.string(),
      protocolVersion: z.string().min(1),
      observedAt: z.string().datetime({ offset: true }).nullable(),
      regions: z.array(
        z.object({
          observedRegion: z.string().min(1),
          macroRegion: z.string().min(1),
          status: z.string(),
          coverageState: z.string(),
          freshnessState: z.string(),
          sampleCount: z.number().int().nonnegative(),
          consumerSuccessCount: z.number().int().nonnegative(),
        })
      ),
    })
  ),
});

export const llmMieruStatusSnapshotSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  coverageGeneratedAt: z.string().datetime({ offset: true }),
  data: z.array(
    z.object({
      id: z.string().min(1),
      providerRoute: z.string().min(1),
      requestedModel: z.string().min(1),
      status: z.string(),
      observedAt: z.string().datetime({ offset: true }).nullable(),
      protocolVersion: z.string(),
      regions: z.array(
        z.object({
          observedRegion: z.string().min(1),
          macroRegion: z.string().min(1),
          status: z.string(),
          coverageState: z.string(),
          freshnessState: z.string(),
          sampleCount: z.number().int().nonnegative(),
          consumerSuccessCount: z.number().int().nonnegative(),
        })
      ),
    })
  ),
});

export const llmMieruIncidentsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      providerRoute: z.string().min(1),
      requestedModel: z.string().min(1),
      state: z.string(),
      severity: z.string(),
      ruleVersion: z.string().min(1),
      openedAt: z.string().datetime({ offset: true }),
      updatedAt: z.string().datetime({ offset: true }).nullable(),
      resolvedAt: z.string().datetime({ offset: true }).nullable(),
      latestEvidence: z.record(z.string(), z.unknown()),
    })
  ),
  nextCursor: z.string().min(1).max(512).optional(),
});

export const llmMieruMetricCatalogSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        unit: z.string().min(1).max(64),
        minimumSamples: z.union([
          z.number().int().nonnegative(),
          z.record(z.string(), z.number().int().nonnegative()),
        ]),
        requiredScenario: z.string().min(1).max(128).optional(),
        estimateKind: z.string().min(1).max(128).optional(),
      })
    )
    .max(64),
});

export const llmMieruMetricQuerySchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  metric: z.string().min(1),
  data: z
    .array(
      z.object({
        window: z.object({
          start: z.string().datetime({ offset: true }),
          end: z.string().datetime({ offset: true }),
        }),
        dimensions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        protocolVersion: z.string().min(1),
        sampleCount: z.number().int().nonnegative(),
        eligibleCount: z.number().int().nonnegative(),
        value: z.record(z.string(), z.unknown()),
        freshness: z.object({
          state: z.string().min(1),
          observedAt: z.string().datetime({ offset: true }).nullable().optional(),
          staleAfter: z.string().datetime({ offset: true }).nullable().optional(),
        }),
        coverageState: z.string().min(1),
        limitations: z.array(z.string()),
      })
    )
    .max(5000),
});

export const llmMieruMethodologySchema = methodologySnapshotSchema;

export type LlmMieruMeta = z.infer<typeof llmMieruMetaSchema>;
export type LlmMieruServices = z.infer<typeof llmMieruServicesSchema>;
export type LlmMieruStatusSnapshot = z.infer<typeof llmMieruStatusSnapshotSchema>;
export type LlmMieruIncidents = z.infer<typeof llmMieruIncidentsSchema>;
export type LlmMieruMetricCatalog = z.infer<typeof llmMieruMetricCatalogSchema>;
export type LlmMieruMetricQuery = z.infer<typeof llmMieruMetricQuerySchema>;
export type LlmMieruMethodology = z.infer<typeof llmMieruMethodologySchema>;

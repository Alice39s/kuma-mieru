import { z } from 'zod';

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
      name: z.string().min(1),
      dimensions: z.object({
        provider_route: z.string().min(1),
        model: z.string().min(1),
        scenario: z.string().min(1),
        observed_region: z.string().min(1),
        macro_region: z.string().min(1),
      }),
    })
  ),
});

export const llmMieruStatusSnapshotSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  coverageGeneratedAt: z.string().datetime({ offset: true }),
  data: z.array(
    z.object({
      serviceId: z.string().min(1),
      status: z.string(),
      rawStatus: z.string(),
      observedAt: z.string().datetime({ offset: true }).nullable(),
      freshness: z.string(),
      protocolVersion: z.string(),
    })
  ),
});

export const llmMieruIncidentsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      summary: z.string(),
      status: z.string(),
      severity: z.string(),
      startedAt: z.string().datetime({ offset: true }).nullable(),
      updatedAt: z.string().datetime({ offset: true }).nullable(),
    })
  ),
});

export type LlmMieruMeta = z.infer<typeof llmMieruMetaSchema>;
export type LlmMieruServices = z.infer<typeof llmMieruServicesSchema>;
export type LlmMieruStatusSnapshot = z.infer<typeof llmMieruStatusSnapshotSchema>;
export type LlmMieruIncidents = z.infer<typeof llmMieruIncidentsSchema>;

import { z } from 'zod';

export interface SourceJsonRequester {
  request<T>(
    url: URL,
    resourceKey: string,
    schema: z.ZodType<T>,
    options?: { headers?: Record<string, string> }
  ): Promise<T>;
}

export const normalizedStatusSchema = z.enum([
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
  'paused',
  'pending',
  'unknown',
]);

export const sourceCapabilitiesSchema = z.object({
  currentStatus: z.boolean(),
  heartbeatSeries: z.boolean(),
  latencySeries: z.boolean(),
  uptimeWindows: z.array(z.string()),
  incidents: z.enum(['none', 'current', 'history']),
  maintenance: z.boolean(),
  groups: z.boolean(),
  tags: z.boolean(),
  nativeMetrics: z.boolean(),
  historicalDays: z.number().nullable(),
});

export const normalizedServiceSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  upstreamId: z.string(),
  name: z.string(),
  groupId: z.string(),
  tags: z.array(z.object({ name: z.string(), value: z.string().optional(), color: z.string() })),
  status: normalizedStatusSchema,
  rawStatus: z.union([z.string(), z.number()]),
  latencyMs: z.number().nullable(),
  observedAt: z.string().nullable(),
  uptime24h: z.number().nullable(),
});

export const metricDefinitionSchema = z.object({
  id: z.string().min(1),
  unit: z.string().min(1),
  minimumSamples: z.union([
    z.number().int().nonnegative(),
    z.record(z.string(), z.number().int().nonnegative()),
  ]),
  requiredScenario: z.string().min(1).optional(),
  presentationHint: z.string().min(1).optional(),
});

export const metricPointSchema = z.object({
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
});

export const metricSeriesSchema = z.object({
  metricId: z.string().min(1),
  unit: z.string().min(1),
  window: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  points: z.array(metricPointSchema),
});

export const metricExtensionSchema = z.object({
  catalog: z.array(metricDefinitionSchema),
  series: z.array(metricSeriesSchema),
});

export const normalizedSnapshotSchema = z.object({
  sourceId: z.string(),
  pageId: z.string(),
  title: z.string(),
  description: z.string(),
  status: normalizedStatusSchema,
  fetchedAt: z.string(),
  sourceUpdatedAt: z.string().nullable(),
  extensions: z.record(z.string(), z.unknown()).default({}),
  capabilities: sourceCapabilitiesSchema,
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      position: z.number(),
      serviceIds: z.array(z.string()),
    })
  ),
  services: z.array(normalizedServiceSchema),
  incidents: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['info', 'warning', 'danger', 'unknown']),
      startedAt: z.string().nullable(),
      updatedAt: z.string().nullable(),
      rawStatus: z.string(),
    })
  ),
});

export type NormalizedStatus = z.infer<typeof normalizedStatusSchema>;
export type SourceCapabilities = z.infer<typeof sourceCapabilitiesSchema>;
export type NormalizedSnapshot = z.infer<typeof normalizedSnapshotSchema>;
export type MetricDefinition = z.infer<typeof metricDefinitionSchema>;
export type MetricSeries = z.infer<typeof metricSeriesSchema>;
export type MetricExtension = z.infer<typeof metricExtensionSchema>;

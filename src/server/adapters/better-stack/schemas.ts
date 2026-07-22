import { z } from 'zod';

const relationshipDataSchema = z.object({ id: z.string(), type: z.string() });

export const betterStackStatusPageSchema = z.object({
  data: z.object({
    id: z.string(),
    type: z.literal('status_page'),
    attributes: z.object({
      company_name: z.string(),
      aggregate_state: z.string(),
      updated_at: z.string().datetime({ offset: true }),
    }),
  }),
  included: z.array(
    z
      .object({
        id: z.string(),
        type: z.string(),
        attributes: z.record(z.string(), z.unknown()),
        relationships: z
          .record(
            z.string(),
            z.object({ data: z.union([relationshipDataSchema, z.array(relationshipDataSchema)]) })
          )
          .optional(),
      })
      .passthrough()
  ),
});

export const betterStackSectionSchema = z.object({
  id: z.string(),
  type: z.literal('status_page_section'),
  attributes: z.object({
    name: z.string(),
    position: z.number(),
  }),
});

export const betterStackResourceSchema = z.object({
  id: z.string(),
  type: z.literal('status_page_resource'),
  attributes: z.object({
    status_page_section_id: z.union([z.string(), z.number()]),
    public_name: z.string(),
    explanation: z.string().optional().default(''),
    position: z.number(),
    availability: z.number().nullable().optional(),
    status: z.string(),
    status_history: z
      .array(
        z.object({
          day: z.string(),
          status: z.string(),
          downtime_duration: z.number(),
          maintenance_duration: z.number(),
        })
      )
      .optional()
      .default([]),
  }),
});

export const betterStackStatusUpdateSchema = z.object({
  id: z.string(),
  type: z.literal('status_update'),
  attributes: z.object({
    message: z.string(),
    published_at: z.string().datetime({ offset: true }),
    affected_resources: z
      .array(z.object({ status_page_resource_id: z.string(), status: z.string() }))
      .optional()
      .default([]),
  }),
});

export const betterStackStatusReportSchema = z.object({
  id: z.string(),
  type: z.literal('status_report'),
  attributes: z.object({
    title: z.string(),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }).nullable(),
    aggregate_state: z.string(),
    affected_resources: z
      .array(z.object({ status_page_resource_id: z.string(), status: z.string() }))
      .optional()
      .default([]),
  }),
  relationships: z
    .object({
      status_updates: z.object({ data: z.array(relationshipDataSchema) }),
    })
    .optional(),
});

export type BetterStackStatusPage = z.infer<typeof betterStackStatusPageSchema>;

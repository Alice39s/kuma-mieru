import { z } from 'zod';

export const incidentStateSchema = z.enum([
  'investigating',
  'identified',
  'monitoring',
  'resolved',
]);

const occurredAtSchema = z.string().datetime({ offset: true });
const affectedComponentsSchema = z.array(z.string().min(1).max(200)).max(100).default([]);

export const incidentCreateSchema = z.object({
  pageId: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50_000),
  state: z.literal('investigating').default('investigating'),
  affectedComponentIds: affectedComponentsSchema,
  occurredAt: occurredAtSchema.optional(),
});

export const incidentUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  state: incidentStateSchema,
  body: z.string().min(1).max(50_000),
  affectedComponentIds: affectedComponentsSchema.optional(),
  occurredAt: occurredAtSchema.optional(),
});

export const incidentReviewSchema = z.object({
  expectedVersion: z.number().int().positive(),
  notifySubscribers: z.boolean(),
});

export const incidentPublishSchema = incidentReviewSchema.extend({
  reviewNonce: z.string().min(1).max(4096),
});

export const publicationSnapshotSchema = z.object({
  publicationId: z.string(),
  eventId: z.string(),
  eventSequence: z.number().int().positive(),
  type: z.literal('incident'),
  pageId: z.string(),
  title: z.string(),
  state: incidentStateSchema,
  body: z.string(),
  affectedComponentIds: z.array(z.string()),
  occurredAt: z.string().datetime({ offset: true }),
  recordedAt: z.string().datetime({ offset: true }),
  publishedAt: z.string().datetime({ offset: true }),
});

export type IncidentCreateInput = z.infer<typeof incidentCreateSchema>;
export type IncidentUpdateInput = z.infer<typeof incidentUpdateSchema>;
export type IncidentState = z.infer<typeof incidentStateSchema>;
export type PublicationSnapshot = z.infer<typeof publicationSnapshotSchema>;

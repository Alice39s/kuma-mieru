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

const publicationSnapshotBaseSchema = z.object({
  publicationId: z.string(),
  eventId: z.string(),
  eventSequence: z.number().int().positive(),
  pageId: z.string(),
  title: z.string(),
  body: z.string(),
  affectedComponentIds: z.array(z.string()),
  occurredAt: z.string().datetime({ offset: true }),
  recordedAt: z.string().datetime({ offset: true }),
  publishedAt: z.string().datetime({ offset: true }),
});

export const incidentPublicationSnapshotSchema = publicationSnapshotBaseSchema.extend({
  type: z.literal('incident'),
  state: incidentStateSchema,
});

export const maintenanceStateSchema = z.enum([
  'draft',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
]);

const maintenanceWindowShape = {
  scheduledStartAt: occurredAtSchema,
  scheduledEndAt: occurredAtSchema,
};

export const maintenanceWindowSchema = z
  .object(maintenanceWindowShape)
  .superRefine((input, context) => {
    if (Date.parse(input.scheduledEndAt) <= Date.parse(input.scheduledStartAt)) {
      context.addIssue({
        code: 'custom',
        path: ['scheduledEndAt'],
        message: 'Maintenance end must be after its start.',
      });
    }
  });

export const maintenanceCreateSchema = z
  .object({
    pageId: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(50_000),
    state: z.literal('draft').default('draft'),
    affectedComponentIds: affectedComponentsSchema,
    occurredAt: occurredAtSchema.optional(),
    ...maintenanceWindowShape,
  })
  .superRefine((input, context) => {
    if (Date.parse(input.scheduledEndAt) <= Date.parse(input.scheduledStartAt)) {
      context.addIssue({
        code: 'custom',
        path: ['scheduledEndAt'],
        message: 'Maintenance end must be after its start.',
      });
    }
  });

export const maintenanceUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  state: maintenanceStateSchema,
  body: z.string().min(1).max(50_000),
  affectedComponentIds: affectedComponentsSchema.optional(),
  occurredAt: occurredAtSchema.optional(),
  scheduledStartAt: occurredAtSchema.optional(),
  scheduledEndAt: occurredAtSchema.optional(),
});

export const maintenancePublicationSnapshotSchema = publicationSnapshotBaseSchema.extend({
  type: z.literal('maintenance'),
  state: maintenanceStateSchema,
  ...maintenanceWindowShape,
});

export const publicationSnapshotSchema = z.discriminatedUnion('type', [
  incidentPublicationSnapshotSchema,
  maintenancePublicationSnapshotSchema,
]);

export type IncidentCreateInput = z.infer<typeof incidentCreateSchema>;
export type IncidentUpdateInput = z.infer<typeof incidentUpdateSchema>;
export type IncidentState = z.infer<typeof incidentStateSchema>;
export type PublicationSnapshot = z.infer<typeof publicationSnapshotSchema>;
export type IncidentPublicationSnapshot = z.infer<typeof incidentPublicationSnapshotSchema>;
export type MaintenanceCreateInput = z.infer<typeof maintenanceCreateSchema>;
export type MaintenanceUpdateInput = z.infer<typeof maintenanceUpdateSchema>;
export type MaintenanceState = z.infer<typeof maintenanceStateSchema>;
export type MaintenancePublicationSnapshot = z.infer<typeof maintenancePublicationSnapshotSchema>;

import { z } from 'zod';

const affectedComponentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  group_name: z.string().min(1).optional(),
  current_status: z.string().optional(),
});

const eventBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string(),
  url: z.string().url(),
  last_update_at: z.string().datetime({ offset: true }),
  last_update_message: z.string(),
  affected_components: z.array(affectedComponentSchema),
});

export const incidentIoSummarySchema = z.object({
  page_title: z.string().min(1),
  page_url: z.string().url(),
  ongoing_incidents: z.array(
    eventBaseSchema.extend({
      current_worst_impact: z.string(),
    })
  ),
  in_progress_maintenances: z.array(
    eventBaseSchema.extend({
      started_at: z.string().datetime({ offset: true }),
      scheduled_end_at: z.string().datetime({ offset: true }),
    })
  ),
  scheduled_maintenances: z.array(
    eventBaseSchema.extend({
      starts_at: z.string().datetime({ offset: true }),
      ends_at: z.string().datetime({ offset: true }),
    })
  ),
});

export type IncidentIoSummary = z.infer<typeof incidentIoSummarySchema>;

import { z } from 'zod';

export const subscriptionRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  componentIds: z.array(z.string().min(1).max(200)).max(100).default([]),
  incidentId: z.string().uuid().optional(),
  nonce: z.string().min(1).max(4096),
  website: z.string().max(500).optional(),
});

export const subscriptionManageSchema = z
  .object({
    componentIds: z.array(z.string().min(1).max(200)).max(100).default([]),
    incidentId: z.string().uuid().nullable().optional(),
  })
  .refine(input => !(input.incidentId && input.componentIds.length > 0), {
    message: 'Incident and component scopes cannot be combined',
  });

export type SubscriptionRequestInput = z.infer<typeof subscriptionRequestSchema>;
export type SubscriptionManageInput = z.infer<typeof subscriptionManageSchema>;

import { z } from 'zod';

export const ownerSetupSchema = z.object({
  token: z.string().min(32, 'Use the complete setup token from the server log.'),
  name: z.string().min(1, 'Name is required.').max(100),
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(12, 'Use at least 12 characters.').max(200),
});

export const signInSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

export const sourceDraftSchema = z
  .object({
    id: z.string().min(1, 'Source ID is required.'),
    kind: z.enum(['uptime-kuma', 'better-stack', 'uptime-robot', 'incident-io']),
    baseUrl: z.string().url('Enter the complete source API or status-page URL.'),
    pageIds: z.string().min(1, 'Add at least one status page slug or snapshot key.'),
    token: z.string(),
  })
  .superRefine((input, context) => {
    if (input.kind === 'uptime-robot' && input.token.trim().length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['token'],
        message: 'A read-only UptimeRobot v3 token is required.',
      });
    }
  });

export const pageDraftSchema = z.object({
  id: z.string().min(1, 'Page ID is required.'),
  slug: z.string().min(1, 'Public slug is required.'),
  title: z.string().min(1, 'Title is required.'),
  sourceRef: z.string().min(1, 'Choose a source.'),
});

export const incidentDraftSchema = z.object({
  pageId: z.string().min(1, 'Choose a status page.'),
  title: z.string().min(1, 'Title is required.').max(200),
  body: z.string().min(1, 'Public update is required.').max(50_000),
  affectedComponentIds: z.string(),
});

export const incidentUpdateDraftSchema = z.object({
  state: z.enum(['investigating', 'identified', 'monitoring', 'resolved']),
  body: z.string().min(1, 'Public update is required.').max(50_000),
  affectedComponentIds: z.string(),
});

export type OwnerSetupInput = z.infer<typeof ownerSetupSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type SourceDraftInput = z.infer<typeof sourceDraftSchema>;
export type PageDraftInput = z.infer<typeof pageDraftSchema>;
export type IncidentDraftInput = z.infer<typeof incidentDraftSchema>;
export type IncidentUpdateDraftInput = z.infer<typeof incidentUpdateDraftSchema>;

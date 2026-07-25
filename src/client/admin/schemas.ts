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

export const twoFactorChallengeSchema = z.object({
  code: z.string().trim().min(1, 'Enter an authenticator or recovery code.').max(128),
  trustDevice: z.boolean(),
});

export const sourceDraftSchema = z
  .object({
    id: z.string().min(1, 'Source ID is required.'),
    kind: z.enum(['uptime-kuma', 'better-stack', 'uptime-robot', 'incident-io', 'llm-mieru']),
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

export const smtpDraftSchema = z
  .object({
    host: z.string().trim().min(1, 'SMTP host is required.').max(253),
    port: z.number().int().min(1).max(65_535),
    tls: z.enum(['starttls', 'implicit']),
    fromName: z.string().trim().max(200),
    fromAddress: z.email('Enter a valid sender address.').max(320),
    replyTo: z.union([z.literal(''), z.email('Enter a valid reply-to address.').max(320)]),
    username: z.string().max(1_024),
    password: z.string().max(16_384),
  })
  .superRefine((input, context) => {
    if (Boolean(input.username) !== Boolean(input.password)) {
      context.addIssue({
        code: 'custom',
        path: [input.username ? 'password' : 'username'],
        message: 'Provide both SMTP username and password, or leave both empty.',
      });
    }
  });

export const smtpTestMessageSchema = z.object({
  recipient: z.email('Enter a valid test recipient.').max(320),
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

export const secondaryEventDraftSchema = z
  .object({
    type: z.enum(['maintenance', 'notice', 'postmortem']),
    pageId: z.string(),
    incidentId: z.string(),
    title: z.string().min(1, 'Public title is required.').max(200),
    body: z.string().min(1, 'Public copy is required.').max(50_000),
    affectedComponentIds: z.string(),
    scheduledStartAt: z.string(),
    scheduledEndAt: z.string(),
    noticeKind: z.enum(['information', 'warning']),
    startsAt: z.string(),
    endsAt: z.string(),
  })
  .superRefine((input, context) => {
    if (input.type === 'postmortem' && input.incidentId.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['incidentId'],
        message: 'Choose a resolved incident.',
      });
    }
    if (input.type !== 'postmortem' && input.pageId.length === 0) {
      context.addIssue({ code: 'custom', path: ['pageId'], message: 'Choose a status page.' });
    }
    if (input.type === 'maintenance') {
      if (!input.scheduledStartAt) {
        context.addIssue({
          code: 'custom',
          path: ['scheduledStartAt'],
          message: 'Start is required.',
        });
      }
      if (!input.scheduledEndAt) {
        context.addIssue({ code: 'custom', path: ['scheduledEndAt'], message: 'End is required.' });
      }
      if (
        input.scheduledStartAt &&
        input.scheduledEndAt &&
        Date.parse(input.scheduledEndAt) <= Date.parse(input.scheduledStartAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['scheduledEndAt'],
          message: 'End must be after start.',
        });
      }
    }
    if (
      input.type === 'notice' &&
      input.startsAt &&
      input.endsAt &&
      Date.parse(input.endsAt) <= Date.parse(input.startsAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'Visible until must be after visible from.',
      });
    }
  });

export const secondaryEventUpdateDraftSchema = z
  .object({
    type: z.enum(['maintenance', 'notice', 'postmortem']),
    state: z.string().min(1),
    body: z.string().min(1, 'Public update is required.').max(50_000),
    affectedComponentIds: z.string(),
    scheduledStartAt: z.string(),
    scheduledEndAt: z.string(),
    noticeKind: z.enum(['information', 'warning']),
    startsAt: z.string(),
    endsAt: z.string(),
  })
  .superRefine((input, context) => {
    if (input.type === 'maintenance') {
      if (!input.scheduledStartAt) {
        context.addIssue({
          code: 'custom',
          path: ['scheduledStartAt'],
          message: 'Start is required.',
        });
      }
      if (!input.scheduledEndAt) {
        context.addIssue({ code: 'custom', path: ['scheduledEndAt'], message: 'End is required.' });
      }
      if (
        input.scheduledStartAt &&
        input.scheduledEndAt &&
        Date.parse(input.scheduledEndAt) <= Date.parse(input.scheduledStartAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['scheduledEndAt'],
          message: 'End must be after start.',
        });
      }
    }
    if (
      input.type === 'notice' &&
      input.startsAt &&
      input.endsAt &&
      Date.parse(input.endsAt) <= Date.parse(input.startsAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'Visible until must be after visible from.',
      });
    }
  });

export const retentionPolicyDraftSchema = z.object({
  eventDraftDays: z.number().int().min(30).max(3650),
  adminAuditDays: z.number().int().min(30).max(3650),
  deliveryAttemptDays: z.number().int().min(30).max(3650),
  backupDays: z.number().int().min(30).max(3650),
});

export const backupDeleteConfirmationSchema = z.object({
  confirmation: z.string().min(1, 'Enter the complete backup ID.'),
});

export const retentionRunConfirmationSchema = z.object({
  confirmation: z.string().superRefine((value, context) => {
    if (value !== 'RUN RETENTION') {
      context.addIssue({
        code: 'custom',
        message: 'Enter RUN RETENTION exactly.',
      });
    }
  }),
});

export type OwnerSetupInput = z.infer<typeof ownerSetupSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type TwoFactorChallengeInput = z.infer<typeof twoFactorChallengeSchema>;
export type SourceDraftInput = z.infer<typeof sourceDraftSchema>;
export type PageDraftInput = z.infer<typeof pageDraftSchema>;
export type SmtpDraftInput = z.infer<typeof smtpDraftSchema>;
export type SmtpTestMessageInput = z.infer<typeof smtpTestMessageSchema>;
export type IncidentDraftInput = z.infer<typeof incidentDraftSchema>;
export type IncidentUpdateDraftInput = z.infer<typeof incidentUpdateDraftSchema>;
export type SecondaryEventDraftInput = z.infer<typeof secondaryEventDraftSchema>;
export type SecondaryEventUpdateDraftInput = z.infer<typeof secondaryEventUpdateDraftSchema>;
export type RetentionPolicyDraftInput = z.infer<typeof retentionPolicyDraftSchema>;
export type BackupDeleteConfirmationInput = z.infer<typeof backupDeleteConfirmationSchema>;
export type RetentionRunConfirmationInput = z.infer<typeof retentionRunConfirmationSchema>;

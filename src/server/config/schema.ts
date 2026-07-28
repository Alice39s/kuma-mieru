import { z } from 'zod';

export const configModeSchema = z.enum(['compatibility', 'managed', 'file']);

const sourceBaseSchema = z.object({
  id: z.string().min(1),
  baseUrl: z.string().url(),
  pageIds: z.array(z.string().min(1)).min(1),
  requestPolicy: z
    .object({
      timeoutMs: z.number().int().min(250).max(120_000).optional(),
    })
    .optional(),
});

export const uptimeKumaSourceSchema = sourceBaseSchema.extend({
  kind: z.literal('uptime-kuma'),
});

export const betterStackSourceSchema = sourceBaseSchema.extend({
  kind: z.literal('better-stack'),
});

export const uptimeRobotSourceSchema = sourceBaseSchema.extend({
  kind: z.literal('uptime-robot'),
  pageIds: z.array(z.union([z.literal('all'), z.string().regex(/^\d+$/u)])).length(1),
  secretRef: z.string().startsWith('sec_'),
});

export const incidentIoSourceSchema = sourceBaseSchema.extend({
  kind: z.literal('incident-io'),
  pageIds: z.tuple([z.literal('summary')]),
});

export const llmMieruSourceSchema = sourceBaseSchema.extend({
  kind: z.literal('llm-mieru'),
  pageIds: z.tuple([z.literal('default')]),
  secretRef: z.string().startsWith('sec_').optional(),
});

export const sourceSchema = z.discriminatedUnion('kind', [
  uptimeKumaSourceSchema,
  betterStackSourceSchema,
  uptimeRobotSourceSchema,
  incidentIoSourceSchema,
  llmMieruSourceSchema,
]);

export const sourcePatchSchema = z.object({
  baseUrl: z.string().url().optional(),
  pageIds: z.array(z.string().min(1)).min(1).optional(),
  secretRef: z.string().startsWith('sec_').optional(),
});

export const statusPageSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().max(10_000).optional(),
  icon: z.string().max(2_048).optional(),
  features: z
    .object({
      editThisPage: z.boolean().optional(),
      showStarButton: z.boolean().optional(),
    })
    .optional(),
  sourceRefs: z.array(z.string().min(1)).min(1),
});

export const controlProviderSchema = z
  .object({
    id: z.string().min(1).max(120),
    kind: z.enum(['uptime-robot-v3', 'better-stack-uptime-v2']),
    displayName: z.string().min(1).max(200),
    enabled: z.boolean().default(true),
    sourceRef: z.string().min(1).max(200).optional(),
    secretRef: z.string().startsWith('sec_'),
  })
  .strict();

const smtpAddressSchema = z.object({
  address: z.email().max(320),
  name: z.string().trim().min(1).max(200).optional(),
});

const disabledSmtpDeliverySchema = z.object({
  enabled: z.literal(false),
});

const enabledSmtpDeliverySchema = z
  .object({
    enabled: z.literal(true),
    host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65_535),
    tls: z.enum(['implicit', 'starttls']),
    from: smtpAddressSchema,
    replyTo: z.email().max(320).optional(),
    credentialSetId: z.string().startsWith('smtp_').max(200).optional(),
    usernameRef: z.string().startsWith('sec_').optional(),
    passwordRef: z.string().startsWith('sec_').optional(),
  })
  .superRefine((smtp, context) => {
    const authenticationFields = [smtp.credentialSetId, smtp.usernameRef, smtp.passwordRef].filter(
      Boolean
    );
    if (authenticationFields.length !== 0 && authenticationFields.length !== 3) {
      context.addIssue({
        code: 'custom',
        path: ['credentialSetId'],
        message: 'SMTP authentication requires one complete staged credential set',
      });
    }
    if (smtp.tls === 'implicit' && smtp.port !== 465) {
      context.addIssue({
        code: 'custom',
        path: ['port'],
        message: 'Implicit TLS SMTP must use port 465',
      });
    }
  });

export const smtpDeliverySchema = z.discriminatedUnion('enabled', [
  disabledSmtpDeliverySchema,
  enabledSmtpDeliverySchema,
]);

export const signalAutomationSchema = z
  .object({
    defaultAction: z.enum(['suggest-draft', 'disabled']).default('suggest-draft'),
    degradedConsecutive: z.number().int().min(2).max(20).default(3),
    recoveryConsecutive: z.number().int().min(2).max(20).default(2),
    cooldownMs: z
      .number()
      .int()
      .min(60_000)
      .max(24 * 60 * 60_000)
      .default(15 * 60_000),
  })
  .prefault({});

export const resolveSignalAutomationConfig = (input?: unknown) =>
  signalAutomationSchema.parse(input);

export const retentionPolicySchema = z
  .object({
    eventDraftDays: z.number().int().min(30).max(3650).default(90),
    adminAuditDays: z.number().int().min(30).max(3650).default(365),
    deliveryAttemptDays: z.number().int().min(30).max(3650).default(90),
    backupDays: z.number().int().min(30).max(3650).default(30),
  })
  .strict();

export const defaultRetentionPolicy = retentionPolicySchema.parse({});

export const resolveRetentionPolicy = (input?: unknown) => retentionPolicySchema.parse(input ?? {});

export const extendRetentionPolicy = (
  active: RetentionPolicy,
  minimum?: RetentionPolicy
): RetentionPolicy =>
  minimum
    ? {
        eventDraftDays: Math.max(active.eventDraftDays, minimum.eventDraftDays),
        adminAuditDays: Math.max(active.adminAuditDays, minimum.adminAuditDays),
        deliveryAttemptDays: Math.max(active.deliveryAttemptDays, minimum.deliveryAttemptDays),
        backupDays: Math.max(active.backupDays, minimum.backupDays),
      }
    : active;

export const canonicalConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    server: z
      .object({
        publicBaseUrl: z.string().url().optional(),
      })
      .default({}),
    delivery: z
      .object({
        smtp: smtpDeliverySchema.optional(),
      })
      .optional(),
    events: z
      .object({
        automation: signalAutomationSchema.optional(),
      })
      .optional(),
    dataLifecycle: z
      .object({
        retention: retentionPolicySchema.optional(),
      })
      .optional(),
    sources: z.array(sourceSchema),
    pages: z.array(statusPageSchema),
    controlProviders: z.array(controlProviderSchema).optional(),
  })
  .superRefine((config, context) => {
    if (config.delivery?.smtp?.enabled && !config.server.publicBaseUrl) {
      context.addIssue({
        code: 'custom',
        path: ['server', 'publicBaseUrl'],
        message: 'SMTP delivery requires an explicit publicBaseUrl',
      });
    }
    const sourceIds = new Set<string>();
    config.sources.forEach((source, index) => {
      if (sourceIds.has(source.id)) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'id'],
          message: `Duplicate source id: ${source.id}`,
        });
      }
      sourceIds.add(source.id);
    });

    const controlProviderIds = new Set<string>();
    (config.controlProviders ?? []).forEach((provider, index) => {
      if (controlProviderIds.has(provider.id)) {
        context.addIssue({
          code: 'custom',
          path: ['controlProviders', index, 'id'],
          message: `Duplicate control provider id: ${provider.id}`,
        });
      }
      if (provider.sourceRef && !sourceIds.has(provider.sourceRef)) {
        context.addIssue({
          code: 'custom',
          path: ['controlProviders', index, 'sourceRef'],
          message: `Unknown source reference: ${provider.sourceRef}`,
        });
      }
      controlProviderIds.add(provider.id);
    });

    const pageIds = new Set<string>();
    const pageSlugs = new Set<string>();
    config.pages.forEach((page, index) => {
      if (pageIds.has(page.id)) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'id'],
          message: `Duplicate page id: ${page.id}`,
        });
      }
      if (pageSlugs.has(page.slug)) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'slug'],
          message: `Duplicate page slug: ${page.slug}`,
        });
      }
      page.sourceRefs.forEach((sourceRef, sourceRefIndex) => {
        if (!sourceIds.has(sourceRef)) {
          context.addIssue({
            code: 'custom',
            path: ['pages', index, 'sourceRefs', sourceRefIndex],
            message: `Unknown source reference: ${sourceRef}`,
          });
        }
      });
      pageIds.add(page.id);
      pageSlugs.add(page.slug);
    });
  });

export type ConfigMode = z.infer<typeof configModeSchema>;
export type CanonicalConfig = z.infer<typeof canonicalConfigSchema>;
export type SmtpDeliveryConfig = z.infer<typeof smtpDeliverySchema>;
export type EnabledSmtpDeliveryConfig = z.infer<typeof enabledSmtpDeliverySchema>;
export type SignalAutomationConfig = z.infer<typeof signalAutomationSchema>;
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

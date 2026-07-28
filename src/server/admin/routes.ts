import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { SourceTestService } from '../adapters/source-test.js';
import { errorResponse, type AppEnvironment } from '../api/errors.js';
import type { KumaAuth } from '../auth/auth.js';
import {
  createCsrfToken,
  getAdminPrincipal,
  hasRole,
  isRecentlyAuthenticated,
  isTrustedBrowserMutation,
  verifyCsrfToken,
  type AdminPrincipal,
} from '../auth/security.js';
import { mutateManagedConfig, rollbackManagedConfig } from '../config/managed-config.js';
import type { FileReloadResult, FileReloadStatus } from '../config/file-reloader.js';
import {
  configModeTransitionApplySchema,
  configModeTransitionErrorCode,
  configModeTransitionPreviewSchema,
  type ConfigModeTransitionService,
} from '../config/mode-transition.js';
import {
  getDurableConfigState,
  listManagedRevisions,
  type ConfigRevision,
} from '../config/repository.js';
import {
  listAdminDeliveries,
  listAdminSubscribers,
  retryAdminDelivery,
  suppressAdminSubscriber,
} from '../delivery/admin-repository.js';
import {
  sourcePatchSchema as sourcePatchValueSchema,
  sourceSchema,
  retentionPolicySchema,
  resolveRetentionPolicy,
  resolveSignalAutomationConfig,
  smtpDeliverySchema,
  statusPageSchema,
} from '../config/schema.js';
import type { RuntimeConfigSnapshot } from '../config/runtime-config.js';
import type { DeliveryRuntimeStatus } from '../delivery/runtime.js';
import type { SmtpTestService } from '../delivery/smtp-config.js';
import type { SecretStore } from '../secrets/store.js';
import { backupErrorCode, type BackupService } from '../db/backup.js';
import { retentionErrorCode, type RetentionService } from '../retention/service.js';
import type { SubscriberTombstoneStore } from '../retention/tombstone-store.js';
import {
  adminAuthErrorCode,
  changeAdminUserRole,
  createAdminUser,
  listAdminUsers,
  listAdminUserSessions,
  revokeAdminUserSession,
} from '../auth/admin-repository.js';
import {
  deleteAdminPasskey,
  listAdminPasskeys,
  passkeyAdminErrorCode,
  recordAdminPasskeyRegistration,
  renameAdminPasskey,
} from '../auth/passkey-repository.js';
import { getAdminTwoFactorStatus } from '../auth/two-factor-repository.js';
import { oidcErrorCode, type OidcControlPlane } from '../auth/oidc.js';
import {
  appendIncidentUpdate,
  createIncident,
  getPublicationReview,
  listIncidents,
  publishIncident,
} from '../events/repository.js';
import {
  acceptAutomationSuggestion,
  getAutomationSuggestion,
  ignoreAutomationSuggestion,
  listAutomationSuggestions,
} from '../events/automation-repository.js';
import { createPublicationReviewService } from '../events/review.js';
import {
  incidentCreateSchema,
  incidentPublishSchema,
  incidentReviewSchema,
  incidentUpdateSchema,
  eventTemplateCreateSchema,
  eventTemplateStateSchema,
  eventTemplateUpdateSchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
  noticeCreateSchema,
  noticeUpdateSchema,
  postmortemCreateSchema,
  postmortemUpdateSchema,
} from '../events/schemas.js';
import {
  appendMaintenanceUpdate,
  createMaintenance,
  getMaintenancePublicationReview,
  listMaintenances,
  publishMaintenance,
} from '../events/maintenance-repository.js';
import {
  appendRecurringMaintenancePlanUpdate,
  createRecurringMaintenancePlan,
  getRecurringMaintenancePlan,
  listRecurringMaintenanceOccurrences,
  listRecurringMaintenancePlans,
  materializeRecurringMaintenancePlan,
} from '../events/recurring-maintenance-repository.js';
import {
  recurringMaintenanceMaterializeSchema,
  recurringMaintenancePlanCreateSchema,
  recurringMaintenancePlanStateSchema,
  recurringMaintenancePlanUpdateSchema,
} from '../events/recurring-maintenance-schemas.js';
import {
  appendNoticeUpdate,
  createNotice,
  getNoticePublicationReview,
  listNotices,
  publishNotice,
} from '../events/notice-repository.js';
import {
  appendPostmortemUpdate,
  createPostmortem,
  getPostmortemPublicationReview,
  listPostmortems,
  publishPostmortem,
} from '../events/postmortem-repository.js';
import {
  appendEventTemplateUpdate,
  createEventTemplate,
  getEventTemplate,
  listEventTemplates,
} from '../events/template-repository.js';
import { getMirroredEventTimeline, listMirroredEvents } from '../events/mirrored-repository.js';
import { createPiiProtector } from '../subscriptions/crypto.js';
import { adminAuditErrorCode, listAdminAudit } from './audit-repository.js';

const pageCreateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  page: statusPageSchema,
});
const pagePatchSchema = z.object({
  expectedRevision: z.number().int().positive(),
  patch: statusPageSchema.partial().omit({ id: true }),
});
const rollbackSchema = z.object({
  expectedRevision: z.number().int().positive(),
  reason: z.string().min(3).max(500),
});
const sourceTestSchema = z.object({ source: sourceSchema });
const sourceCreateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  source: sourceSchema,
  testToken: z.string().min(1),
});
const sourcePatchSchema = z.object({
  expectedRevision: z.number().int().positive(),
  patch: sourcePatchValueSchema,
  testToken: z.string().min(1),
});
const sourceTokenSecretSchema = z.object({
  resourceId: z.string().min(1).max(200),
  value: z.string().min(1).max(16_384),
});
const smtpCredentialSecretSchema = z.object({
  username: z.string().min(1).max(1_024),
  password: z.string().min(1).max(16_384),
});

const redactSourceForRead = (source: z.infer<typeof sourceSchema>) => {
  const baseUrl = new URL(source.baseUrl);
  baseUrl.username = '';
  baseUrl.password = '';
  baseUrl.search = '';
  baseUrl.hash = '';
  const readableBase = { ...source, baseUrl: baseUrl.toString() };
  if ('secretRef' in readableBase) {
    const { secretRef, ...readable } = readableBase;
    return { ...readable, authenticated: Boolean(secretRef) };
  }
  return { ...readableBase, authenticated: false };
};
const smtpTestSchema = z.object({ smtp: smtpDeliverySchema });
const smtpTestMessageSchema = z.object({ recipient: z.email().max(320) });
const smtpUpdateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  smtp: smtpDeliverySchema,
  testToken: z.string().min(1).optional(),
});
const idempotencyKeySchema = z.string().min(8).max(200);
const automationSuggestionStateSchema = z
  .enum(['pending', 'accepted', 'ignored', 'superseded'])
  .optional();
const eventTemplateQuerySchema = z.object({ state: eventTemplateStateSchema.optional() }).strict();
const recurringMaintenanceQuerySchema = z
  .object({ state: recurringMaintenancePlanStateSchema.optional() })
  .strict();
const automationSuggestionAcceptSchema = z.object({
  expectedVersion: z.number().int().positive(),
  expectedNativeEventVersion: z.number().int().positive().optional(),
});
const automationSuggestionIgnoreSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
const adminListLimitSchema = z.coerce.number().int().min(1).max(500).default(200);
const deliveryRetrySchema = z.object({ expectedState: z.enum(['failed', 'dead_letter']) });
const subscriberSuppressSchema = z.object({ expectedState: z.literal('active') });
const backupRestoreValidateSchema = z.object({
  backupId: z.string().min(1).max(64),
});
const backupDeleteSchema = z.object({
  expectedManifestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
});
const emptyMutationSchema = z.object({}).strict();
const retentionPolicyMutationSchema = z.object({
  expectedRevision: z.number().int().positive(),
  policy: retentionPolicySchema,
});
const adminAuditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(1_024).optional(),
    action: z.string().trim().min(1).max(200).optional(),
    result: z.enum(['success', 'denied', 'failed']).optional(),
  })
  .strict();
const adminRoleSchema = z.enum(['owner', 'publisher', 'editor', 'viewer']);
const adminUserCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.email().max(320),
    password: z.string().min(12).max(200),
    role: z.enum(['publisher', 'editor', 'viewer']),
  })
  .strict();
const adminUserRoleSchema = z
  .object({
    expectedRole: adminRoleSchema,
    role: adminRoleSchema,
  })
  .strict();
const passkeyNameSchema = z.string().trim().min(1).max(100);
const passkeyRegisterOptionsSchema = z
  .object({
    name: passkeyNameSchema,
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  })
  .strict();
const passkeyRegisterVerifySchema = z
  .object({
    name: passkeyNameSchema,
    response: z.record(z.string(), z.unknown()),
  })
  .strict();
const passkeyRenameSchema = z
  .object({
    expectedName: z.string().max(100).nullable(),
    name: passkeyNameSchema,
  })
  .strict();
const passkeyDeleteSchema = z
  .object({
    expectedName: z.string().max(100).nullable(),
  })
  .strict();
const twoFactorPasswordSchema = z.object({ password: z.string().min(1).max(1024) }).strict();
const twoFactorVerifySchema = z
  .object({
    code: z
      .string()
      .trim()
      .length(6)
      .refine(code => [...code].every(character => character >= '0' && character <= '9')),
  })
  .strict();
const oidcProviderSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    displayName: z.string().trim().min(1).max(100),
    discoveryUrl: z.url().max(2_048),
    clientId: z.string().trim().min(1).max(1_024),
    clientSecret: z.string().min(1).max(16_384).optional(),
    tokenEndpointAuthMethod: z.enum(['client_secret_basic', 'client_secret_post']),
  })
  .strict();
const oidcDisableSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const oidcMappingSchema = z
  .object({
    expectedSubject: z.string().trim().min(1).max(512).nullable(),
    subject: z.string().trim().min(1).max(512),
  })
  .strict();
const oidcMappingDeleteSchema = z
  .object({ expectedSubject: z.string().trim().min(1).max(512) })
  .strict();
const controlApiKeyCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    access: z.enum(['read-only', 'manager']),
    expiresIn: z
      .number()
      .int()
      .min(24 * 60 * 60)
      .max(365 * 24 * 60 * 60)
      .nullable(),
  })
  .strict();
const controlApiKeyDeleteSchema = z
  .object({ expectedName: z.string().max(100).nullable() })
  .strict();

const controlPermissions = (access: z.infer<typeof controlApiKeyCreateSchema>['access']) => ({
  provider: access === 'manager' ? ['read', 'write'] : ['read'],
  monitor: access === 'manager' ? ['read', 'write'] : ['read'],
  operation: access === 'manager' ? ['read', 'resolve'] : ['read'],
});

export interface AdminRouteOptions {
  database?: Database.Database;
  auth?: KumaAuth;
  authSecret?: string;
  trustedOrigins: string[];
  sourceTest?: SourceTestService;
  smtpTest?: SmtpTestService;
  getDeliveryRuntimeStatus?: () => DeliveryRuntimeStatus;
  secretStore?: SecretStore;
  currentSnapshot: () => RuntimeConfigSnapshot;
  onManagedRevision?: (revision: ConfigRevision) => void | Promise<void>;
  getFileReloadStatus?: () => FileReloadStatus | null;
  reloadFileConfig?: () => Promise<FileReloadResult>;
  modeTransitions?: ConfigModeTransitionService;
  backupService?: BackupService;
  retentionService?: RetentionService;
  subscriberTombstones?: SubscriberTombstoneStore;
  oidc?: OidcControlPlane;
  onAuthConfigurationChanged?: () => void | Promise<void>;
}

export const registerAdminRoutes = (
  app: Hono<AppEnvironment>,
  {
    database,
    auth,
    authSecret,
    trustedOrigins,
    sourceTest,
    smtpTest,
    getDeliveryRuntimeStatus,
    secretStore,
    currentSnapshot,
    onManagedRevision,
    getFileReloadStatus,
    reloadFileConfig,
    modeTransitions,
    backupService,
    retentionService,
    subscriberTombstones,
    oidc,
    onAuthConfigurationChanged,
  }: AdminRouteOptions
) => {
  const publicationReview = authSecret ? createPublicationReviewService(authSecret) : null;
  const piiProtector = authSecret ? createPiiProtector(authSecret) : null;
  const writeRouteAudit = (
    context: Context<AppEnvironment>,
    actorId: string,
    result: 'success' | 'denied' | 'failed',
    errorCode: string | null
  ) => {
    if (!database) return;
    database
      .prepare(
        `INSERT INTO admin_audit
          (id, occurred_at, actor_id, action, target_type, target_id, request_id,
           user_agent, result, error_code)
         VALUES (?, ?, ?, ?, 'api_route', ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        new Date().toISOString(),
        actorId,
        `${context.req.method} ${context.req.path}`,
        context.req.path,
        context.get('requestId'),
        context.req.header('user-agent') ?? null,
        result,
        errorCode
      );
  };

  const requireAdmin = async (
    context: Context<AppEnvironment>,
    roles: AdminPrincipal['role'][],
    mutation = false,
    recentAuthentication = false
  ) => {
    const principal = await getAdminPrincipal(auth, context.req.raw.headers);
    if (!principal) {
      return {
        ok: false as const,
        response: errorResponse(context, 401, 'UNAUTHENTICATED', 'Authentication required'),
      };
    }
    if (!hasRole(principal, roles)) {
      writeRouteAudit(context, principal.userId, 'denied', 'FORBIDDEN');
      return {
        ok: false as const,
        response: errorResponse(context, 403, 'FORBIDDEN', 'Role does not permit this action'),
      };
    }
    if (recentAuthentication && !isRecentlyAuthenticated(principal)) {
      writeRouteAudit(context, principal.userId, 'denied', 'REAUTH_REQUIRED');
      return {
        ok: false as const,
        response: errorResponse(
          context,
          403,
          'REAUTH_REQUIRED',
          'Recent authentication is required'
        ),
      };
    }
    if (mutation) {
      if (!isTrustedBrowserMutation(context.req.raw, trustedOrigins)) {
        writeRouteAudit(context, principal.userId, 'denied', 'UNTRUSTED_ORIGIN');
        return {
          ok: false as const,
          response: errorResponse(
            context,
            403,
            'UNTRUSTED_ORIGIN',
            'Mutation origin is not trusted'
          ),
        };
      }
      if (
        !authSecret ||
        !verifyCsrfToken(authSecret, principal.sessionId, context.req.header('x-kuma-csrf'))
      ) {
        writeRouteAudit(context, principal.userId, 'denied', 'CSRF_TOKEN_INVALID');
        return {
          ok: false as const,
          response: errorResponse(context, 403, 'CSRF_TOKEN_INVALID', 'CSRF token is invalid'),
        };
      }
      if (!context.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
        writeRouteAudit(context, principal.userId, 'denied', 'JSON_REQUIRED');
        return {
          ok: false as const,
          response: errorResponse(context, 415, 'JSON_REQUIRED', 'Admin mutations require JSON'),
        };
      }
    }
    return { ok: true as const, principal };
  };

  const auditContext = (context: Context<AppEnvironment>, principal: AdminPrincipal) => ({
    actorId: principal.userId,
    requestId: context.get('requestId'),
    userAgent: context.req.header('user-agent'),
  });

  const handleManagedError = (
    context: Context<AppEnvironment>,
    error: unknown,
    principal: AdminPrincipal
  ) => {
    if (error instanceof z.ZodError) {
      writeRouteAudit(context, principal.userId, 'failed', 'VALIDATION_FAILED');
      return errorResponse(
        context,
        400,
        'VALIDATION_FAILED',
        'Configuration is invalid',
        error.issues
      );
    }
    const code =
      typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'CONFIG_MUTATION_FAILED';
    const status =
      code === 'config_revision_conflict' ? 409 : code === 'config_revision_not_found' ? 404 : 400;
    writeRouteAudit(context, principal.userId, 'failed', code.toUpperCase());
    return errorResponse(
      context,
      status,
      code.toUpperCase(),
      error instanceof Error ? error.message : 'Configuration mutation failed'
    );
  };

  const handleConfigTransitionError = (
    context: Context<AppEnvironment>,
    error: unknown,
    principal: AdminPrincipal
  ) => {
    const code =
      error instanceof z.ZodError ? 'validation_failed' : configModeTransitionErrorCode(error);
    const status =
      code === 'config_preview_token_invalid' || code === 'config_preview_actor_mismatch'
        ? 404
        : code === 'config_transition_in_progress' ||
            code === 'config_transition_mode_conflict' ||
            code === 'config_transition_same_mode' ||
            code === 'config_revision_conflict' ||
            code === 'config_managed_base_conflict' ||
            code === 'config_preview_token_consumed' ||
            code === 'config_preview_token_expired' ||
            code === 'config_preview_request_mismatch' ||
            code === 'config_source_hash_drift'
          ? 409
          : 400;
    writeRouteAudit(context, principal.userId, 'failed', code.toUpperCase());
    return errorResponse(
      context,
      status,
      code.toUpperCase(),
      error instanceof z.ZodError
        ? 'Configuration transition request is invalid'
        : error instanceof Error
          ? error.message
          : 'Configuration transition failed',
      error instanceof z.ZodError ? error.issues : undefined
    );
  };

  app.use(
    '/api/v1/admin/*',
    bodyLimit({
      maxSize: 256 * 1024,
      onError: context =>
        errorResponse(context, 413, 'BODY_TOO_LARGE', 'Admin JSON body exceeds 256 KiB'),
    })
  );
  const noStore = async (context: Context<AppEnvironment>, next: () => Promise<void>) => {
    await next();
    context.header('Cache-Control', 'no-store');
  };
  app.use('/api/v1/admin/backups', noStore);
  app.use('/api/v1/admin/backups/*', noStore);
  app.use('/api/v1/admin/retention', noStore);
  app.use('/api/v1/admin/retention/*', noStore);
  app.use('/api/v1/admin/config/transitions/*', noStore);
  app.use('/api/v1/admin/audit', noStore);
  app.use('/api/v1/admin/users', noStore);
  app.use('/api/v1/admin/users/*', noStore);
  app.use('/api/v1/admin/security', noStore);
  app.use('/api/v1/admin/security/*', noStore);
  app.use('/api/v1/admin/event-templates', noStore);
  app.use('/api/v1/admin/event-templates/*', noStore);

  app.get('/api/v1/admin/session', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    return context.json({
      data: {
        userId: authorization.principal.userId,
        role: authorization.principal.role,
        csrfToken: authSecret
          ? createCsrfToken(authSecret, authorization.principal.sessionId)
          : null,
      },
    });
  });

  app.get('/api/v1/admin/security/control-api-keys', async context => {
    const authorization = await requireAdmin(context, ['owner']);
    if (!authorization.ok) return authorization.response;
    if (!auth) {
      return errorResponse(context, 503, 'AUTH_NOT_READY', 'Authentication is unavailable');
    }
    try {
      const result = await auth.api.listApiKeys({
        headers: context.req.raw.headers,
        query: { configId: 'control-rpc', limit: 100, offset: 0 },
      });
      return context.json({
        data: result.apiKeys.map(key => ({
          id: key.id,
          name: key.name,
          prefix: key.prefix,
          start: key.start,
          enabled: key.enabled,
          access: key.metadata?.access === 'manager' ? 'manager' : 'read-only',
          expiresAt: key.expiresAt?.toISOString() ?? null,
          lastRequest: key.lastRequest?.toISOString() ?? null,
          createdAt: key.createdAt.toISOString(),
        })),
      });
    } catch {
      writeRouteAudit(context, authorization.principal.userId, 'failed', 'CONTROL_KEY_LIST_FAILED');
      return errorResponse(
        context,
        500,
        'CONTROL_KEY_LIST_FAILED',
        'Control API keys are unavailable'
      );
    }
  });

  app.post('/api/v1/admin/security/control-api-keys', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!auth) {
      return errorResponse(context, 503, 'AUTH_NOT_READY', 'Authentication is unavailable');
    }
    try {
      const input = controlApiKeyCreateSchema.parse(await context.req.json());
      const result = await auth.api.createApiKey({
        body: {
          configId: 'control-rpc',
          name: input.name,
          expiresIn: input.expiresIn,
          userId: authorization.principal.userId,
          permissions: controlPermissions(input.access),
          metadata: { access: input.access },
        },
      });
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json(
        {
          data: {
            id: result.id,
            name: result.name,
            key: result.key,
            prefix: result.prefix,
            start: result.start,
            enabled: result.enabled,
            access: input.access,
            expiresAt: result.expiresAt?.toISOString() ?? null,
            lastRequest: result.lastRequest?.toISOString() ?? null,
            createdAt: result.createdAt.toISOString(),
          },
        },
        201
      );
    } catch (error) {
      const code = error instanceof z.ZodError ? 'VALIDATION_FAILED' : 'CONTROL_KEY_CREATE_FAILED';
      writeRouteAudit(context, authorization.principal.userId, 'failed', code);
      return errorResponse(
        context,
        error instanceof z.ZodError ? 400 : 500,
        code,
        error instanceof z.ZodError
          ? 'Control API key input is invalid'
          : 'Control API key was not created',
        error instanceof z.ZodError ? error.issues : undefined
      );
    }
  });

  app.delete('/api/v1/admin/security/control-api-keys/:keyId', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!auth) {
      return errorResponse(context, 503, 'AUTH_NOT_READY', 'Authentication is unavailable');
    }
    try {
      const input = controlApiKeyDeleteSchema.parse(await context.req.json());
      const listed = await auth.api.listApiKeys({
        headers: context.req.raw.headers,
        query: { configId: 'control-rpc', limit: 100, offset: 0 },
      });
      const key = listed.apiKeys.find(candidate => candidate.id === context.req.param('keyId'));
      if (!key) {
        return errorResponse(
          context,
          404,
          'CONTROL_KEY_NOT_FOUND',
          'Control API key was not found'
        );
      }
      if (key.name !== input.expectedName) {
        return errorResponse(
          context,
          409,
          'CONTROL_KEY_CHANGED',
          'Control API key metadata changed; refresh before deleting'
        );
      }
      await auth.api.deleteApiKey({
        headers: context.req.raw.headers,
        body: { configId: 'control-rpc', keyId: key.id },
      });
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({ data: { id: key.id, deleted: true } });
    } catch (error) {
      const code = error instanceof z.ZodError ? 'VALIDATION_FAILED' : 'CONTROL_KEY_DELETE_FAILED';
      writeRouteAudit(context, authorization.principal.userId, 'failed', code);
      return errorResponse(
        context,
        error instanceof z.ZodError ? 400 : 500,
        code,
        error instanceof z.ZodError
          ? 'Control API key input is invalid'
          : 'Control API key was not deleted',
        error instanceof z.ZodError ? error.issues : undefined
      );
    }
  });

  app.get('/api/v1/admin/config/revisions', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database)
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Configuration database is unavailable'
      );
    return context.json({ data: listManagedRevisions(database) });
  });

  app.get('/api/v1/admin/audit', async context => {
    const authorization = await requireAdmin(context, ['owner']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Admin audit database is unavailable'
      );
    }
    try {
      const query = adminAuditQuerySchema.parse(context.req.query());
      return context.json({ data: listAdminAudit(database, query) });
    } catch (error) {
      const code =
        error instanceof z.ZodError ? 'ADMIN_AUDIT_QUERY_INVALID' : adminAuditErrorCode(error);
      return errorResponse(
        context,
        400,
        code.toUpperCase(),
        code === 'admin_audit_cursor_invalid' || code === 'admin_audit_cursor_filter_mismatch'
          ? 'Admin audit cursor is invalid'
          : 'Admin audit query is invalid'
      );
    }
  });

  const handleAdminAuthError = (
    context: Context<AppEnvironment>,
    error: unknown,
    principal: AdminPrincipal
  ) => {
    const code = error instanceof z.ZodError ? 'validation_failed' : adminAuthErrorCode(error);
    const status =
      code === 'admin_user_not_found' || code === 'admin_session_not_found'
        ? 404
        : code === 'admin_auth_failed' ||
            code === 'admin_auth_date_invalid' ||
            code === 'admin_user_create_failed'
          ? 500
          : code === 'validation_failed'
            ? 400
            : 409;
    const message =
      code === 'admin_auth_failed' ||
      code === 'admin_auth_date_invalid' ||
      code === 'admin_user_create_failed'
        ? 'Authentication administration failed'
        : error instanceof Error
          ? error.message
          : 'Authentication administration failed';
    writeRouteAudit(context, principal.userId, 'failed', code.toUpperCase());
    return errorResponse(
      context,
      status,
      code.toUpperCase(),
      message,
      error instanceof z.ZodError ? error.issues : undefined
    );
  };

  app.get('/api/v1/admin/users', async context => {
    const authorization = await requireAdmin(context, ['owner']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Authentication database is unavailable'
      );
    }
    try {
      return context.json({ data: listAdminUsers(database) });
    } catch (error) {
      return handleAdminAuthError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/users', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!database || !auth) {
      return errorResponse(context, 503, 'AUTH_NOT_READY', 'Authentication service is unavailable');
    }
    try {
      const input = adminUserCreateSchema.parse(await context.req.json());
      const user = await createAdminUser(database, auth, {
        ...input,
        audit: auditContext(context, authorization.principal),
      });
      return context.json({ data: user }, 201);
    } catch (error) {
      return handleAdminAuthError(context, error, authorization.principal);
    }
  });

  app.put('/api/v1/admin/users/:userId/role', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Authentication database is unavailable'
      );
    }
    try {
      const input = adminUserRoleSchema.parse(await context.req.json());
      const data = changeAdminUserRole(database, {
        actorUserId: authorization.principal.userId,
        userId: context.req.param('userId'),
        ...input,
        audit: auditContext(context, authorization.principal),
      });
      return context.json({ data });
    } catch (error) {
      return handleAdminAuthError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/users/:userId/sessions', async context => {
    const authorization = await requireAdmin(context, ['owner']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Authentication database is unavailable'
      );
    }
    try {
      return context.json({
        data: listAdminUserSessions(
          database,
          context.req.param('userId'),
          authorization.principal.sessionId
        ),
      });
    } catch (error) {
      return handleAdminAuthError(context, error, authorization.principal);
    }
  });

  app.delete('/api/v1/admin/users/:userId/sessions/:sessionId', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Authentication database is unavailable'
      );
    }
    try {
      emptyMutationSchema.parse(await context.req.json());
      const data = revokeAdminUserSession(database, {
        currentSessionId: authorization.principal.sessionId,
        userId: context.req.param('userId'),
        sessionId: context.req.param('sessionId'),
        audit: auditContext(context, authorization.principal),
      });
      return context.json({ data });
    } catch (error) {
      return handleAdminAuthError(context, error, authorization.principal);
    }
  });

  const handleOidcError = (
    context: Context<AppEnvironment>,
    error: unknown,
    principal: AdminPrincipal
  ) => {
    const code = error instanceof z.ZodError ? 'validation_failed' : oidcErrorCode(error);
    const status =
      code === 'oidc_user_not_found' || code === 'oidc_mapping_not_found'
        ? 404
        : code === 'oidc_admin_failed' || code === 'oidc_date_invalid'
          ? 500
          : code === 'validation_failed' ||
              code === 'oidc_endpoint_invalid' ||
              code === 'oidc_endpoint_origin_mismatch' ||
              code === 'oidc_code_flow_unsupported' ||
              code === 'oidc_pkce_unsupported' ||
              code === 'oidc_scope_unsupported' ||
              code === 'oidc_client_auth_unsupported'
            ? 400
            : 409;
    writeRouteAudit(context, principal.userId, 'failed', code.toUpperCase());
    return errorResponse(
      context,
      status,
      code.toUpperCase(),
      status === 500
        ? 'OIDC administration failed'
        : error instanceof Error
          ? error.message
          : 'OIDC administration failed',
      error instanceof z.ZodError ? error.issues : undefined
    );
  };

  app.get('/api/v1/admin/security/oidc', async context => {
    const authorization = await requireAdmin(context, ['owner']);
    if (!authorization.ok) return authorization.response;
    if (!oidc) {
      return errorResponse(context, 503, 'OIDC_NOT_READY', 'OIDC control plane is unavailable');
    }
    try {
      return context.json({ data: oidc.getProvider() });
    } catch (error) {
      return handleOidcError(context, error, authorization.principal);
    }
  });

  app.put('/api/v1/admin/security/oidc', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!oidc) {
      return errorResponse(context, 503, 'OIDC_NOT_READY', 'OIDC control plane is unavailable');
    }
    try {
      const input = oidcProviderSchema.parse(await context.req.json());
      const data = await oidc.configure(input, auditContext(context, authorization.principal));
      await onAuthConfigurationChanged?.();
      return context.json({ data });
    } catch (error) {
      return handleOidcError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/security/oidc/disable', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!oidc) {
      return errorResponse(context, 503, 'OIDC_NOT_READY', 'OIDC control plane is unavailable');
    }
    try {
      const input = oidcDisableSchema.parse(await context.req.json());
      const data = oidc.disable(input, auditContext(context, authorization.principal));
      await onAuthConfigurationChanged?.();
      return context.json({ data });
    } catch (error) {
      return handleOidcError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/security/oidc/mappings', async context => {
    const authorization = await requireAdmin(context, ['owner']);
    if (!authorization.ok) return authorization.response;
    if (!oidc) {
      return errorResponse(context, 503, 'OIDC_NOT_READY', 'OIDC control plane is unavailable');
    }
    try {
      return context.json({ data: oidc.listMappings() });
    } catch (error) {
      return handleOidcError(context, error, authorization.principal);
    }
  });

  app.put('/api/v1/admin/security/oidc/mappings/:userId', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!oidc) {
      return errorResponse(context, 503, 'OIDC_NOT_READY', 'OIDC control plane is unavailable');
    }
    try {
      const input = oidcMappingSchema.parse(await context.req.json());
      const data = oidc.configureMapping(
        context.req.param('userId'),
        input,
        auditContext(context, authorization.principal)
      );
      return context.json({ data });
    } catch (error) {
      return handleOidcError(context, error, authorization.principal);
    }
  });

  app.delete('/api/v1/admin/security/oidc/mappings/:userId', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!oidc) {
      return errorResponse(context, 503, 'OIDC_NOT_READY', 'OIDC control plane is unavailable');
    }
    try {
      const input = oidcMappingDeleteSchema.parse(await context.req.json());
      return context.json({
        data: oidc.deleteMapping(
          context.req.param('userId'),
          input,
          auditContext(context, authorization.principal)
        ),
      });
    } catch (error) {
      return handleOidcError(context, error, authorization.principal);
    }
  });

  const handlePasskeyError = (
    context: Context<AppEnvironment>,
    error: unknown,
    principal: AdminPrincipal
  ) => {
    const code = error instanceof z.ZodError ? 'validation_failed' : passkeyAdminErrorCode(error);
    const status =
      code === 'passkey_not_found'
        ? 404
        : code === 'validation_failed'
          ? 400
          : code === 'passkey_admin_failed' || code === 'passkey_date_invalid'
            ? 500
            : 409;
    const message =
      status === 500
        ? 'Passkey administration failed'
        : error instanceof Error
          ? error.message
          : 'Passkey administration failed';
    writeRouteAudit(context, principal.userId, 'failed', code.toUpperCase());
    return errorResponse(
      context,
      status,
      code.toUpperCase(),
      message,
      error instanceof z.ZodError ? error.issues : undefined
    );
  };

  const forwardAuthCookies = (context: Context<AppEnvironment>, headers: Headers | undefined) => {
    for (const cookie of headers?.getSetCookie() ?? []) {
      context.header('Set-Cookie', cookie, { append: true });
    }
  };

  app.get('/api/v1/admin/security/passkeys', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Authentication database is unavailable'
      );
    }
    try {
      return context.json({
        data: listAdminPasskeys(database, authorization.principal.userId),
      });
    } catch (error) {
      return handlePasskeyError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/security/passkeys/register/options', async context => {
    const authorization = await requireAdmin(
      context,
      ['owner', 'publisher', 'editor', 'viewer'],
      true,
      true
    );
    if (!authorization.ok) return authorization.response;
    if (!auth) {
      return errorResponse(context, 503, 'AUTH_NOT_READY', 'Authentication service is unavailable');
    }
    try {
      const input = passkeyRegisterOptionsSchema.parse(await context.req.json());
      const generated = await auth.api.generatePasskeyRegistrationOptions({
        headers: context.req.raw.headers,
        query: input,
        returnHeaders: true,
      });
      forwardAuthCookies(context, generated.headers);
      return context.json({ data: { options: generated.response, name: input.name } });
    } catch (error) {
      if (!(error instanceof z.ZodError)) {
        writeRouteAudit(
          context,
          authorization.principal.userId,
          'failed',
          'PASSKEY_OPTIONS_FAILED'
        );
        return errorResponse(
          context,
          400,
          'PASSKEY_OPTIONS_FAILED',
          'Passkey registration could not be started'
        );
      }
      return handlePasskeyError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/security/passkeys/register/verify', async context => {
    const authorization = await requireAdmin(
      context,
      ['owner', 'publisher', 'editor', 'viewer'],
      true,
      true
    );
    if (!authorization.ok) return authorization.response;
    if (!database || !auth) {
      return errorResponse(context, 503, 'AUTH_NOT_READY', 'Authentication service is unavailable');
    }
    try {
      const input = passkeyRegisterVerifySchema.parse(await context.req.json());
      const verified = await auth.api.verifyPasskeyRegistration({
        headers: context.req.raw.headers,
        body: input,
        returnHeaders: true,
      });
      const registered = verified.response as { id?: unknown };
      if (typeof registered.id !== 'string') {
        throw Object.assign(new Error('Passkey registration response is invalid'), {
          code: 'passkey_admin_failed',
        });
      }
      try {
        const passkey = recordAdminPasskeyRegistration(
          database,
          authorization.principal.userId,
          registered.id,
          auditContext(context, authorization.principal)
        );
        forwardAuthCookies(context, verified.headers);
        return context.json({ data: passkey }, 201);
      } catch (error) {
        database
          .prepare('DELETE FROM "passkey" WHERE id = ? AND userId = ?')
          .run(registered.id, authorization.principal.userId);
        throw error;
      }
    } catch (error) {
      const code = passkeyAdminErrorCode(error);
      if (!(error instanceof z.ZodError) && !code.startsWith('passkey_')) {
        writeRouteAudit(
          context,
          authorization.principal.userId,
          'failed',
          'PASSKEY_VERIFICATION_FAILED'
        );
        return errorResponse(
          context,
          400,
          'PASSKEY_VERIFICATION_FAILED',
          'Passkey registration could not be verified'
        );
      }
      return handlePasskeyError(context, error, authorization.principal);
    }
  });

  app.put('/api/v1/admin/security/passkeys/:passkeyId', async context => {
    const authorization = await requireAdmin(
      context,
      ['owner', 'publisher', 'editor', 'viewer'],
      true
    );
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Authentication database is unavailable'
      );
    }
    try {
      const input = passkeyRenameSchema.parse(await context.req.json());
      return context.json({
        data: renameAdminPasskey(database, {
          userId: authorization.principal.userId,
          passkeyId: context.req.param('passkeyId'),
          ...input,
          audit: auditContext(context, authorization.principal),
        }),
      });
    } catch (error) {
      return handlePasskeyError(context, error, authorization.principal);
    }
  });

  app.delete('/api/v1/admin/security/passkeys/:passkeyId', async context => {
    const authorization = await requireAdmin(
      context,
      ['owner', 'publisher', 'editor', 'viewer'],
      true,
      true
    );
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Authentication database is unavailable'
      );
    }
    try {
      const input = passkeyDeleteSchema.parse(await context.req.json());
      return context.json({
        data: deleteAdminPasskey(database, {
          userId: authorization.principal.userId,
          passkeyId: context.req.param('passkeyId'),
          ...input,
          audit: auditContext(context, authorization.principal),
        }),
      });
    } catch (error) {
      return handlePasskeyError(context, error, authorization.principal);
    }
  });

  const twoFactorUnavailable = (context: Context<AppEnvironment>) =>
    errorResponse(context, 503, 'AUTH_NOT_READY', 'Authentication service is unavailable');

  const twoFactorFailure = (
    context: Context<AppEnvironment>,
    principal: AdminPrincipal,
    code: string,
    message: string,
    error?: unknown
  ) => {
    writeRouteAudit(context, principal.userId, 'failed', code);
    return errorResponse(
      context,
      error instanceof z.ZodError ? 400 : 409,
      code,
      message,
      error instanceof z.ZodError ? error.issues : undefined
    );
  };

  app.get('/api/v1/admin/security/two-factor', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) return twoFactorUnavailable(context);
    return context.json({
      data: getAdminTwoFactorStatus(database, authorization.principal.userId),
    });
  });

  app.post('/api/v1/admin/security/two-factor/setup', async context => {
    const authorization = await requireAdmin(
      context,
      ['owner', 'publisher', 'editor', 'viewer'],
      true,
      true
    );
    if (!authorization.ok) return authorization.response;
    if (!database || !auth) return twoFactorUnavailable(context);
    try {
      const current = getAdminTwoFactorStatus(database, authorization.principal.userId);
      if (current.enabled) {
        return twoFactorFailure(
          context,
          authorization.principal,
          'TWO_FACTOR_ALREADY_ENABLED',
          'Two-factor authentication is already enabled'
        );
      }
      const input = twoFactorPasswordSchema.parse(await context.req.json());
      const result = await auth.api.enableTwoFactor({
        headers: context.req.raw.headers,
        body: input,
        returnHeaders: true,
      });
      const setup = z
        .object({
          totpURI: z.string().startsWith('otpauth://'),
          backupCodes: z.array(z.string().min(1)).min(1),
        })
        .parse(result.response);
      forwardAuthCookies(context, result.headers);
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({ data: setup });
    } catch (error) {
      return twoFactorFailure(
        context,
        authorization.principal,
        error instanceof z.ZodError ? 'VALIDATION_FAILED' : 'TWO_FACTOR_SETUP_FAILED',
        'Two-factor setup could not be started',
        error
      );
    }
  });

  app.post('/api/v1/admin/security/two-factor/setup/verify', async context => {
    const authorization = await requireAdmin(
      context,
      ['owner', 'publisher', 'editor', 'viewer'],
      true,
      true
    );
    if (!authorization.ok) return authorization.response;
    if (!database || !auth) return twoFactorUnavailable(context);
    try {
      const current = getAdminTwoFactorStatus(database, authorization.principal.userId);
      if (!current.setupPending) {
        return twoFactorFailure(
          context,
          authorization.principal,
          'TWO_FACTOR_SETUP_NOT_PENDING',
          'Two-factor setup is not pending'
        );
      }
      const input = twoFactorVerifySchema.parse(await context.req.json());
      const result = await auth.api.verifyTOTP({
        headers: context.req.raw.headers,
        body: input,
        returnHeaders: true,
      });
      const status = getAdminTwoFactorStatus(database, authorization.principal.userId);
      if (!status.enabled) throw new Error('Two-factor setup did not become active');
      forwardAuthCookies(context, result.headers);
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({ data: status });
    } catch (error) {
      return twoFactorFailure(
        context,
        authorization.principal,
        error instanceof z.ZodError ? 'VALIDATION_FAILED' : 'TWO_FACTOR_VERIFICATION_FAILED',
        'The authenticator code could not be verified',
        error
      );
    }
  });

  app.post('/api/v1/admin/security/two-factor/recovery-codes', async context => {
    const authorization = await requireAdmin(
      context,
      ['owner', 'publisher', 'editor', 'viewer'],
      true,
      true
    );
    if (!authorization.ok) return authorization.response;
    if (!database || !auth) return twoFactorUnavailable(context);
    try {
      const current = getAdminTwoFactorStatus(database, authorization.principal.userId);
      if (!current.enabled) {
        return twoFactorFailure(
          context,
          authorization.principal,
          'TWO_FACTOR_NOT_ENABLED',
          'Two-factor authentication is not enabled'
        );
      }
      const input = twoFactorPasswordSchema.parse(await context.req.json());
      const result = await auth.api.generateBackupCodes({
        headers: context.req.raw.headers,
        body: input,
        returnHeaders: true,
      });
      const generated = z
        .object({ status: z.literal(true), backupCodes: z.array(z.string().min(1)).min(1) })
        .parse(result.response);
      forwardAuthCookies(context, result.headers);
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({ data: { backupCodes: generated.backupCodes } });
    } catch (error) {
      return twoFactorFailure(
        context,
        authorization.principal,
        error instanceof z.ZodError ? 'VALIDATION_FAILED' : 'RECOVERY_CODES_FAILED',
        'Recovery codes could not be regenerated',
        error
      );
    }
  });

  app.post('/api/v1/admin/security/two-factor/disable', async context => {
    const authorization = await requireAdmin(
      context,
      ['owner', 'publisher', 'editor', 'viewer'],
      true,
      true
    );
    if (!authorization.ok) return authorization.response;
    if (!database || !auth) return twoFactorUnavailable(context);
    try {
      const current = getAdminTwoFactorStatus(database, authorization.principal.userId);
      if (!current.enabled && !current.setupPending) {
        return twoFactorFailure(
          context,
          authorization.principal,
          'TWO_FACTOR_NOT_CONFIGURED',
          'Two-factor authentication is not configured'
        );
      }
      const input = twoFactorPasswordSchema.parse(await context.req.json());
      const result = await auth.api.disableTwoFactor({
        headers: context.req.raw.headers,
        body: input,
        returnHeaders: true,
      });
      forwardAuthCookies(context, result.headers);
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({
        data: getAdminTwoFactorStatus(database, authorization.principal.userId),
      });
    } catch (error) {
      return twoFactorFailure(
        context,
        authorization.principal,
        error instanceof z.ZodError ? 'VALIDATION_FAILED' : 'TWO_FACTOR_DISABLE_FAILED',
        'Two-factor authentication could not be disabled',
        error
      );
    }
  });

  const handleBackupError = (
    context: Context<AppEnvironment>,
    error: unknown,
    principal: AdminPrincipal
  ) => {
    const code = error instanceof z.ZodError ? 'validation_failed' : backupErrorCode(error);
    const status =
      code === 'backup_not_found'
        ? 404
        : code === 'backup_in_progress' ||
            code === 'backup_not_ready' ||
            code === 'backup_not_eligible' ||
            code === 'backup_delete_conflict' ||
            code === 'backup_manifest_hash_mismatch'
          ? 409
          : code === 'backup_space_insufficient'
            ? 507
            : 400;
    writeRouteAudit(context, principal.userId, 'failed', code.toUpperCase());
    const safeMessage =
      code.startsWith('backup_') && error instanceof Error
        ? error.message
        : 'Backup operation failed';
    return errorResponse(
      context,
      status,
      code.toUpperCase(),
      error instanceof z.ZodError ? 'Backup request is invalid' : safeMessage
    );
  };

  app.get('/api/v1/admin/backups', async context => {
    const authorization = await requireAdmin(context, ['owner']);
    if (!authorization.ok) return authorization.response;
    if (!backupService) {
      return errorResponse(context, 503, 'BACKUP_NOT_READY', 'Backup service is unavailable');
    }
    return context.json({ data: backupService.list() });
  });

  app.post('/api/v1/admin/backups', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!backupService) {
      return errorResponse(context, 503, 'BACKUP_NOT_READY', 'Backup service is unavailable');
    }
    try {
      z.object({})
        .strict()
        .parse(await context.req.json());
      const backup = await backupService.create(authorization.principal.userId);
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({ data: backup }, 201);
    } catch (error) {
      return handleBackupError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/backups/restore/validate', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!backupService) {
      return errorResponse(context, 503, 'BACKUP_NOT_READY', 'Backup service is unavailable');
    }
    try {
      const input = backupRestoreValidateSchema.parse(await context.req.json());
      const validation = await backupService.validate(input.backupId);
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({ data: validation });
    } catch (error) {
      return handleBackupError(context, error, authorization.principal);
    }
  });

  app.delete('/api/v1/admin/backups/:backupId', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!backupService) {
      return errorResponse(context, 503, 'BACKUP_NOT_READY', 'Backup service is unavailable');
    }
    try {
      const input = backupDeleteSchema.parse(await context.req.json());
      const deleted = await backupService.deleteEligible({
        backupId: context.req.param('backupId'),
        expectedManifestSha256: input.expectedManifestSha256,
        deletedBy: authorization.principal.userId,
      });
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({ data: deleted });
    } catch (error) {
      return handleBackupError(context, error, authorization.principal);
    }
  });

  const handleRetentionError = (
    context: Context<AppEnvironment>,
    error: unknown,
    principal: AdminPrincipal
  ) => {
    const code = error instanceof z.ZodError ? 'validation_failed' : retentionErrorCode(error);
    const status = code === 'retention_in_progress' ? 409 : 400;
    writeRouteAudit(context, principal.userId, 'failed', code.toUpperCase());
    return errorResponse(
      context,
      status,
      code.toUpperCase(),
      error instanceof z.ZodError
        ? 'Retention request is invalid'
        : error instanceof Error
          ? error.message
          : 'Retention operation failed'
    );
  };

  app.get('/api/v1/admin/retention', async context => {
    const authorization = await requireAdmin(context, ['owner']);
    if (!authorization.ok) return authorization.response;
    if (!retentionService) {
      return errorResponse(context, 503, 'RETENTION_NOT_READY', 'Retention service is unavailable');
    }
    return context.json({
      data: {
        policy: resolveRetentionPolicy(currentSnapshot().config.dataLifecycle?.retention),
        runs: retentionService.list(),
      },
    });
  });

  app.post('/api/v1/admin/retention/preview', async context => {
    const authorization = await requireAdmin(context, ['owner'], true);
    if (!authorization.ok) return authorization.response;
    if (!retentionService) {
      return errorResponse(context, 503, 'RETENTION_NOT_READY', 'Retention service is unavailable');
    }
    try {
      emptyMutationSchema.parse(await context.req.json());
      const preview = retentionService.preview();
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({ data: preview });
    } catch (error) {
      return handleRetentionError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/retention/run', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!retentionService) {
      return errorResponse(context, 503, 'RETENTION_NOT_READY', 'Retention service is unavailable');
    }
    try {
      emptyMutationSchema.parse(await context.req.json());
      const run = await retentionService.run('admin', authorization.principal.userId);
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({ data: run });
    } catch (error) {
      return handleRetentionError(context, error, authorization.principal);
    }
  });

  app.put('/api/v1/admin/retention/policy', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Retention database is unavailable');
    }
    if (currentSnapshot().mode !== 'managed') {
      writeRouteAudit(context, authorization.principal.userId, 'failed', 'CONFIG_READ_ONLY');
      return errorResponse(
        context,
        409,
        'CONFIG_READ_ONLY',
        'Retention policy is managed by the active configuration file'
      );
    }
    try {
      const input = retentionPolicyMutationSchema.parse(await context.req.json());
      const revision = mutateManagedConfig(database, {
        expectedRevision: input.expectedRevision,
        audit: auditContext(context, authorization.principal),
        action: 'retention.policy.update',
        targetType: 'retention_policy',
        mutate: config => ({
          ...config,
          dataLifecycle: {
            ...config.dataLifecycle,
            retention: input.policy,
          },
        }),
      });
      await onManagedRevision?.(revision);
      return context.json({
        data: {
          revision: revision.revision,
          policy: resolveRetentionPolicy(revision.config.dataLifecycle?.retention),
        },
      });
    } catch (error) {
      return handleManagedError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/sources', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    return context.json({
      data: currentSnapshot().config.sources.map(redactSourceForRead),
    });
  });

  app.post('/api/v1/admin/secrets/source-token', async context => {
    const authorization = await requireAdmin(context, ['owner', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!secretStore || !database) {
      return errorResponse(context, 503, 'SECRET_STORE_NOT_READY', 'Secret storage is unavailable');
    }
    try {
      const input = sourceTokenSecretSchema.parse(await context.req.json());
      if (currentSnapshot().config.sources.some(source => source.id === input.resourceId)) {
        writeRouteAudit(context, authorization.principal.userId, 'failed', 'SOURCE_ALREADY_EXISTS');
        return errorResponse(
          context,
          409,
          'SOURCE_ALREADY_EXISTS',
          'Create flow cannot replace a token bound to an existing source'
        );
      }
      const metadata = database.transaction(() => {
        const stored = secretStore.put(
          { resourceId: input.resourceId, fieldName: 'apiToken', purpose: 'source-token' },
          input.value
        );
        database
          .prepare(
            `INSERT INTO admin_audit
              (id, occurred_at, actor_id, action, target_type, target_id, request_id,
               user_agent, result, error_code)
             VALUES (?, ?, ?, 'secret.upsert', 'secret', ?, ?, ?, 'success', NULL)`
          )
          .run(
            randomUUID(),
            new Date().toISOString(),
            authorization.principal.userId,
            input.resourceId,
            context.get('requestId'),
            context.req.header('user-agent') ?? null
          );
        return stored;
      })();
      return context.json({ data: metadata }, 201);
    } catch (error) {
      const code = error instanceof z.ZodError ? 'VALIDATION_FAILED' : 'SECRET_WRITE_FAILED';
      writeRouteAudit(context, authorization.principal.userId, 'failed', code);
      return errorResponse(
        context,
        400,
        code,
        error instanceof z.ZodError ? 'Secret input is invalid' : 'Secret could not be stored'
      );
    }
  });

  app.post('/api/v1/admin/secrets/smtp-credentials', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!secretStore || !database) {
      return errorResponse(context, 503, 'SECRET_STORE_NOT_READY', 'Secret storage is unavailable');
    }
    try {
      const input = smtpCredentialSecretSchema.parse(await context.req.json());
      const credentialSetId = `smtp_${randomUUID()}`;
      const resourceId = `delivery.smtp:${credentialSetId}`;
      const stored = database.transaction(() => {
        const username = secretStore.put(
          { resourceId, fieldName: 'username', purpose: 'smtp-credential' },
          input.username
        );
        const password = secretStore.put(
          { resourceId, fieldName: 'password', purpose: 'smtp-credential' },
          input.password
        );
        database
          .prepare(
            `INSERT INTO admin_audit
              (id, occurred_at, actor_id, action, target_type, target_id, request_id,
               user_agent, result, error_code)
             VALUES (?, ?, ?, 'smtp.credentials.stage', 'secret_set', ?, ?, ?, 'success', NULL)`
          )
          .run(
            randomUUID(),
            new Date().toISOString(),
            authorization.principal.userId,
            credentialSetId,
            context.get('requestId'),
            context.req.header('user-agent') ?? null
          );
        return {
          credentialSetId,
          usernameRef: username.secretRef,
          passwordRef: password.secretRef,
        };
      })();
      return context.json({ data: stored }, 201);
    } catch (error) {
      const code = error instanceof z.ZodError ? 'VALIDATION_FAILED' : 'SECRET_WRITE_FAILED';
      writeRouteAudit(context, authorization.principal.userId, 'failed', code);
      return errorResponse(
        context,
        400,
        code,
        error instanceof z.ZodError
          ? 'SMTP credential input is invalid'
          : 'SMTP credentials could not be stored'
      );
    }
  });

  app.get('/api/v1/admin/delivery/smtp', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher']);
    if (!authorization.ok) return authorization.response;
    const smtp = currentSnapshot().config.delivery?.smtp;
    const configuration = smtp?.enabled
      ? {
          enabled: true,
          host: smtp.host,
          port: smtp.port,
          tls: smtp.tls,
          from: smtp.from,
          replyTo: smtp.replyTo ?? null,
          authenticated: Boolean(smtp.credentialSetId),
        }
      : { enabled: false };
    context.header('Cache-Control', 'no-store');
    return context.json({
      data: {
        runtime: getDeliveryRuntimeStatus?.() ?? {
          state: 'disabled',
          configured: Boolean(smtp),
          appliedAt: currentSnapshot().loadedAt,
          lastErrorCode: null,
        },
        configuration,
      },
    });
  });

  app.post('/api/v1/admin/delivery/smtp/test', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!smtpTest) {
      return errorResponse(context, 503, 'SMTP_TEST_NOT_READY', 'SMTP testing is unavailable');
    }
    try {
      const input = smtpTestSchema.parse(await context.req.json());
      const result = await smtpTest.test(input.smtp);
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({ data: result });
    } catch (error) {
      const code = error instanceof z.ZodError ? 'VALIDATION_FAILED' : 'SMTP_TEST_FAILED';
      writeRouteAudit(context, authorization.principal.userId, 'failed', code);
      return errorResponse(
        context,
        400,
        code,
        error instanceof z.ZodError
          ? 'SMTP configuration is invalid'
          : 'SMTP connection verification failed'
      );
    }
  });

  app.post('/api/v1/admin/delivery/smtp/send-test', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!smtpTest) {
      return errorResponse(context, 503, 'SMTP_TEST_NOT_READY', 'SMTP testing is unavailable');
    }
    const smtp = currentSnapshot().config.delivery?.smtp;
    if (!smtp?.enabled) {
      return errorResponse(context, 409, 'SMTP_DISABLED', 'SMTP delivery is not active');
    }
    try {
      const input = smtpTestMessageSchema.parse(await context.req.json());
      const result = await smtpTest.sendTest(smtp, input.recipient);
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({ data: result });
    } catch (error) {
      const code = error instanceof z.ZodError ? 'VALIDATION_FAILED' : 'SMTP_TEST_SEND_FAILED';
      writeRouteAudit(context, authorization.principal.userId, 'failed', code);
      return errorResponse(
        context,
        400,
        code,
        error instanceof z.ZodError ? 'Test recipient is invalid' : 'SMTP test message failed'
      );
    }
  });

  app.put('/api/v1/admin/delivery/smtp', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Configuration database is unavailable'
      );
    }
    if (currentSnapshot().mode !== 'managed') {
      return errorResponse(
        context,
        409,
        'CONFIG_MODE_READ_ONLY',
        'SMTP is writable only in managed mode'
      );
    }
    try {
      const input = smtpUpdateSchema.parse(await context.req.json());
      if (
        input.smtp.enabled &&
        (!smtpTest || !input.testToken || !smtpTest.validate(input.smtp, input.testToken))
      ) {
        return errorResponse(
          context,
          400,
          'SMTP_TEST_TOKEN_INVALID',
          'SMTP test token is invalid or expired'
        );
      }
      const revision = mutateManagedConfig(database, {
        expectedRevision: input.expectedRevision,
        audit: auditContext(context, authorization.principal),
        action: input.smtp.enabled ? 'smtp.enable' : 'smtp.disable',
        targetType: 'delivery_transport',
        targetId: 'smtp',
        mutate: config => ({
          ...config,
          delivery: { ...config.delivery, smtp: input.smtp },
        }),
      });
      await onManagedRevision?.(revision);
      return context.json({ data: { revision: revision.revision, applyStatus: 'active' } });
    } catch (error) {
      return handleManagedError(context, error, authorization.principal);
    }
  });

  const handleEventError = (
    context: Context<AppEnvironment>,
    error: unknown,
    principal: AdminPrincipal
  ) => {
    if (error instanceof z.ZodError) {
      writeRouteAudit(context, principal.userId, 'failed', 'VALIDATION_FAILED');
      return errorResponse(
        context,
        400,
        'VALIDATION_FAILED',
        'Event input is invalid',
        error.issues
      );
    }
    const code =
      typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'event_mutation_failed';
    const status = code.endsWith('_not_found')
      ? 404
      : code.includes('conflict') ||
          code.includes('already') ||
          code.includes('resolved') ||
          code.includes('stale') ||
          code.includes('reused') ||
          code.includes('archived')
        ? 409
        : 400;
    writeRouteAudit(context, principal.userId, 'failed', code.toUpperCase());
    return errorResponse(
      context,
      status,
      code.toUpperCase(),
      error instanceof Error ? error.message : 'Event mutation failed'
    );
  };

  app.get('/api/v1/admin/events', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    return context.json({ data: listIncidents(database) });
  });

  app.get('/api/v1/admin/mirrored-events', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    const filters = currentSnapshot().config.sources.flatMap(source =>
      source.pageIds.map(pageId => ({ sourceId: source.id, pageId }))
    );
    return context.json({ data: listMirroredEvents(database, filters) });
  });

  app.get('/api/v1/admin/mirrored-events/:id', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    const filters = currentSnapshot().config.sources.flatMap(source =>
      source.pageIds.map(pageId => ({ sourceId: source.id, pageId }))
    );
    const event = getMirroredEventTimeline(database, filters, context.req.param('id'));
    return event
      ? context.json({ data: event })
      : errorResponse(context, 404, 'MIRRORED_EVENT_NOT_FOUND', 'Mirrored source event not found');
  });

  app.get('/api/v1/admin/automation/suggestions', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const state = automationSuggestionStateSchema.parse(context.req.query('state'));
      return context.json({ data: listAutomationSuggestions(database, state) });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/automation/suggestions/:id', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    const suggestion = getAutomationSuggestion(database, context.req.param('id'));
    return suggestion
      ? context.json({ data: suggestion })
      : errorResponse(
          context,
          404,
          'AUTOMATION_SUGGESTION_NOT_FOUND',
          'Automation suggestion not found'
        );
  });

  app.get('/api/v1/admin/event-templates', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const query = eventTemplateQuerySchema.parse(context.req.query());
      return context.json({ data: listEventTemplates(database, query.state) });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/event-templates/:id', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    const template = getEventTemplate(database, context.req.param('id'));
    return template
      ? context.json({ data: template })
      : errorResponse(context, 404, 'EVENT_TEMPLATE_NOT_FOUND', 'Event template not found');
  });

  app.post('/api/v1/admin/event-templates', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const idempotencyKey = idempotencyKeySchema.parse(context.req.header('idempotency-key'));
      const template = createEventTemplate(
        database,
        eventTemplateCreateSchema.parse(await context.req.json()),
        idempotencyKey,
        auditContext(context, authorization.principal)
      );
      return context.json({ data: template }, 201);
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/event-templates/:id/updates', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const template = appendEventTemplateUpdate(
        database,
        context.req.param('id'),
        eventTemplateUpdateSchema.parse(await context.req.json()),
        auditContext(context, authorization.principal)
      );
      return context.json({ data: template });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/automation/suggestions/:id/accept', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const idempotencyKey = idempotencyKeySchema.parse(context.req.header('idempotency-key'));
      const input = automationSuggestionAcceptSchema.parse(await context.req.json());
      const result = acceptAutomationSuggestion(
        database,
        {
          suggestionId: context.req.param('id'),
          expectedVersion: input.expectedVersion,
          expectedNativeEventVersion: input.expectedNativeEventVersion,
          idempotencyKey,
        },
        auditContext(context, authorization.principal)
      );
      return context.json({ data: result }, 201);
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/automation/suggestions/:id/ignore', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const input = automationSuggestionIgnoreSchema.parse(await context.req.json());
      const suggestion = ignoreAutomationSuggestion(
        database,
        {
          suggestionId: context.req.param('id'),
          expectedVersion: input.expectedVersion,
          cooldownMs: resolveSignalAutomationConfig(currentSnapshot().config.events?.automation)
            .cooldownMs,
        },
        auditContext(context, authorization.principal)
      );
      return context.json({ data: suggestion });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/incidents', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const idempotencyKey = idempotencyKeySchema.parse(context.req.header('idempotency-key'));
      const input = incidentCreateSchema.parse(await context.req.json());
      const page = currentSnapshot().config.pages.find(
        candidate => candidate.id === input.pageId || candidate.slug === input.pageId
      );
      if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
      const incident = createIncident(
        database,
        { ...input, pageId: page.id },
        idempotencyKey,
        auditContext(context, authorization.principal)
      );
      return context.json({ data: incident }, 201);
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/incidents/:id/updates', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const input = incidentUpdateSchema.parse(await context.req.json());
      const incident = appendIncidentUpdate(
        database,
        context.req.param('id'),
        input,
        auditContext(context, authorization.principal)
      );
      return context.json({ data: incident });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/incidents/:id/review', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher'], true);
    if (!authorization.ok) return authorization.response;
    if (!database || !publicationReview) {
      return errorResponse(context, 503, 'EVENT_REVIEW_NOT_READY', 'Event review is unavailable');
    }
    try {
      const input = incidentReviewSchema.parse(await context.req.json());
      const review = getPublicationReview(database, context.req.param('id'), input.expectedVersion);
      const token = publicationReview.create({
        eventId: review.incident.id,
        eventVersion: review.incident.version,
        notifySubscribers: input.notifySubscribers,
        estimatedRecipients: review.estimatedRecipients,
        principal: authorization.principal,
      });
      return context.json({
        data: {
          incident: review.incident,
          notifySubscribers: input.notifySubscribers,
          estimatedRecipients: review.estimatedRecipients,
          reviewNonce: token.nonce,
          expiresAt: token.expiresAt,
        },
      });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/incidents/:id/publish', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher'], true);
    if (!authorization.ok) return authorization.response;
    if (!database || !publicationReview) {
      return errorResponse(context, 503, 'EVENT_REVIEW_NOT_READY', 'Event review is unavailable');
    }
    try {
      const eventId = context.req.param('id');
      const input = incidentPublishSchema.parse(await context.req.json());
      const review = getPublicationReview(database, eventId, input.expectedVersion);
      const reviewInput = {
        eventId,
        eventVersion: input.expectedVersion,
        notifySubscribers: input.notifySubscribers,
        estimatedRecipients: review.estimatedRecipients,
        principal: authorization.principal,
      };
      if (!publicationReview.verify(reviewInput, input.reviewNonce)) {
        writeRouteAudit(
          context,
          authorization.principal.userId,
          'failed',
          'PUBLICATION_REVIEW_INVALID'
        );
        return errorResponse(
          context,
          409,
          'PUBLICATION_REVIEW_INVALID',
          'Publication review is invalid, expired, or stale'
        );
      }
      const publication = publishIncident(
        database,
        {
          eventId,
          expectedVersion: input.expectedVersion,
          notifySubscribers: input.notifySubscribers,
          expectedRecipients: review.estimatedRecipients,
          piiProtector: piiProtector ?? undefined,
        },
        auditContext(context, authorization.principal)
      );
      return context.json({ data: publication }, 201);
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/maintenances', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    return context.json({ data: listMaintenances(database) });
  });

  app.post('/api/v1/admin/maintenances', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const idempotencyKey = idempotencyKeySchema.parse(context.req.header('idempotency-key'));
      const input = maintenanceCreateSchema.parse(await context.req.json());
      const page = currentSnapshot().config.pages.find(
        candidate => candidate.id === input.pageId || candidate.slug === input.pageId
      );
      if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
      const maintenance = createMaintenance(
        database,
        { ...input, pageId: page.id },
        idempotencyKey,
        auditContext(context, authorization.principal)
      );
      return context.json({ data: maintenance }, 201);
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/maintenances/:id/updates', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const maintenance = appendMaintenanceUpdate(
        database,
        context.req.param('id'),
        maintenanceUpdateSchema.parse(await context.req.json()),
        auditContext(context, authorization.principal)
      );
      return context.json({ data: maintenance });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/maintenances/:id/review', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher'], true);
    if (!authorization.ok) return authorization.response;
    if (!database || !publicationReview) {
      return errorResponse(context, 503, 'EVENT_REVIEW_NOT_READY', 'Event review is unavailable');
    }
    try {
      const input = incidentReviewSchema.parse(await context.req.json());
      const review = getMaintenancePublicationReview(
        database,
        context.req.param('id'),
        input.expectedVersion
      );
      const token = publicationReview.create({
        eventId: review.event.id,
        eventVersion: review.event.version,
        notifySubscribers: input.notifySubscribers,
        estimatedRecipients: review.estimatedRecipients,
        principal: authorization.principal,
      });
      return context.json({
        data: {
          maintenance: review.event,
          notifySubscribers: input.notifySubscribers,
          estimatedRecipients: review.estimatedRecipients,
          reviewNonce: token.nonce,
          expiresAt: token.expiresAt,
        },
      });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/maintenances/:id/publish', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher'], true);
    if (!authorization.ok) return authorization.response;
    if (!database || !publicationReview) {
      return errorResponse(context, 503, 'EVENT_REVIEW_NOT_READY', 'Event review is unavailable');
    }
    try {
      const eventId = context.req.param('id');
      const input = incidentPublishSchema.parse(await context.req.json());
      const review = getMaintenancePublicationReview(database, eventId, input.expectedVersion);
      const reviewInput = {
        eventId,
        eventVersion: input.expectedVersion,
        notifySubscribers: input.notifySubscribers,
        estimatedRecipients: review.estimatedRecipients,
        principal: authorization.principal,
      };
      if (!publicationReview.verify(reviewInput, input.reviewNonce)) {
        writeRouteAudit(
          context,
          authorization.principal.userId,
          'failed',
          'PUBLICATION_REVIEW_INVALID'
        );
        return errorResponse(
          context,
          409,
          'PUBLICATION_REVIEW_INVALID',
          'Publication review is invalid, expired, or stale'
        );
      }
      const publication = publishMaintenance(
        database,
        {
          eventId,
          expectedVersion: input.expectedVersion,
          notifySubscribers: input.notifySubscribers,
          expectedRecipients: review.estimatedRecipients,
          piiProtector: piiProtector ?? undefined,
        },
        auditContext(context, authorization.principal)
      );
      return context.json({ data: publication }, 201);
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/recurring-maintenance-plans', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const query = recurringMaintenanceQuerySchema.parse(context.req.query());
      return context.json({ data: listRecurringMaintenancePlans(database, query.state) });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/recurring-maintenance-plans/:id', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    const plan = getRecurringMaintenancePlan(database, context.req.param('id'));
    return plan
      ? context.json({ data: plan })
      : errorResponse(
          context,
          404,
          'RECURRING_MAINTENANCE_NOT_FOUND',
          'Recurring maintenance plan not found'
        );
  });

  app.get('/api/v1/admin/recurring-maintenance-plans/:id/occurrences', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    const plan = getRecurringMaintenancePlan(database, context.req.param('id'));
    return plan
      ? context.json({ data: listRecurringMaintenanceOccurrences(database, plan.id) })
      : errorResponse(
          context,
          404,
          'RECURRING_MAINTENANCE_NOT_FOUND',
          'Recurring maintenance plan not found'
        );
  });

  app.post('/api/v1/admin/recurring-maintenance-plans', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const idempotencyKey = idempotencyKeySchema.parse(context.req.header('idempotency-key'));
      const input = recurringMaintenancePlanCreateSchema.parse(await context.req.json());
      const page = currentSnapshot().config.pages.find(
        candidate => candidate.id === input.pageId || candidate.slug === input.pageId
      );
      if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
      const data = database.transaction(() => {
        const plan = createRecurringMaintenancePlan(
          database,
          { ...input, pageId: page.id },
          idempotencyKey,
          auditContext(context, authorization.principal)
        );
        const materialization = materializeRecurringMaintenancePlan(database, plan.id, {
          expectedVersion: plan.version,
        });
        return { plan, materialization };
      })();
      return context.json({ data }, 201);
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/recurring-maintenance-plans/:id/updates', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const input = recurringMaintenancePlanUpdateSchema.parse(await context.req.json());
      const data = database.transaction(() => {
        const plan = appendRecurringMaintenancePlanUpdate(
          database,
          context.req.param('id'),
          input,
          auditContext(context, authorization.principal)
        );
        const materialization = materializeRecurringMaintenancePlan(database, plan.id, {
          expectedVersion: plan.version,
        });
        return { plan, materialization };
      })();
      return context.json({ data });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/recurring-maintenance-plans/:id/materialize', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const input = recurringMaintenanceMaterializeSchema.parse(await context.req.json());
      const materialization = materializeRecurringMaintenancePlan(
        database,
        context.req.param('id'),
        { expectedVersion: input.expectedVersion }
      );
      return context.json({ data: materialization });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/notices', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    return context.json({ data: listNotices(database) });
  });

  app.post('/api/v1/admin/notices', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const idempotencyKey = idempotencyKeySchema.parse(context.req.header('idempotency-key'));
      const input = noticeCreateSchema.parse(await context.req.json());
      const page = currentSnapshot().config.pages.find(
        candidate => candidate.id === input.pageId || candidate.slug === input.pageId
      );
      if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
      const notice = createNotice(
        database,
        { ...input, pageId: page.id },
        idempotencyKey,
        auditContext(context, authorization.principal)
      );
      return context.json({ data: notice }, 201);
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/notices/:id/updates', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const notice = appendNoticeUpdate(
        database,
        context.req.param('id'),
        noticeUpdateSchema.parse(await context.req.json()),
        auditContext(context, authorization.principal)
      );
      return context.json({ data: notice });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/notices/:id/review', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher'], true);
    if (!authorization.ok) return authorization.response;
    if (!database || !publicationReview) {
      return errorResponse(context, 503, 'EVENT_REVIEW_NOT_READY', 'Event review is unavailable');
    }
    try {
      const input = incidentReviewSchema.parse(await context.req.json());
      const review = getNoticePublicationReview(
        database,
        context.req.param('id'),
        input.expectedVersion
      );
      const token = publicationReview.create({
        eventId: review.event.id,
        eventVersion: review.event.version,
        notifySubscribers: input.notifySubscribers,
        estimatedRecipients: review.estimatedRecipients,
        principal: authorization.principal,
      });
      return context.json({
        data: {
          notice: review.event,
          notifySubscribers: input.notifySubscribers,
          estimatedRecipients: review.estimatedRecipients,
          reviewNonce: token.nonce,
          expiresAt: token.expiresAt,
        },
      });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/notices/:id/publish', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher'], true);
    if (!authorization.ok) return authorization.response;
    if (!database || !publicationReview) {
      return errorResponse(context, 503, 'EVENT_REVIEW_NOT_READY', 'Event review is unavailable');
    }
    try {
      const eventId = context.req.param('id');
      const input = incidentPublishSchema.parse(await context.req.json());
      const review = getNoticePublicationReview(database, eventId, input.expectedVersion);
      const reviewInput = {
        eventId,
        eventVersion: input.expectedVersion,
        notifySubscribers: input.notifySubscribers,
        estimatedRecipients: review.estimatedRecipients,
        principal: authorization.principal,
      };
      if (!publicationReview.verify(reviewInput, input.reviewNonce)) {
        writeRouteAudit(
          context,
          authorization.principal.userId,
          'failed',
          'PUBLICATION_REVIEW_INVALID'
        );
        return errorResponse(
          context,
          409,
          'PUBLICATION_REVIEW_INVALID',
          'Publication review is invalid, expired, or stale'
        );
      }
      const publication = publishNotice(
        database,
        {
          eventId,
          expectedVersion: input.expectedVersion,
          notifySubscribers: input.notifySubscribers,
          expectedRecipients: review.estimatedRecipients,
          piiProtector: piiProtector ?? undefined,
        },
        auditContext(context, authorization.principal)
      );
      return context.json({ data: publication }, 201);
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/postmortems', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    return context.json({ data: listPostmortems(database) });
  });

  app.post('/api/v1/admin/postmortems', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const idempotencyKey = idempotencyKeySchema.parse(context.req.header('idempotency-key'));
      const postmortem = createPostmortem(
        database,
        postmortemCreateSchema.parse(await context.req.json()),
        idempotencyKey,
        auditContext(context, authorization.principal)
      );
      return context.json({ data: postmortem }, 201);
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/postmortems/:id/updates', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Event database is unavailable');
    }
    try {
      const postmortem = appendPostmortemUpdate(
        database,
        context.req.param('id'),
        postmortemUpdateSchema.parse(await context.req.json()),
        auditContext(context, authorization.principal)
      );
      return context.json({ data: postmortem });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/postmortems/:id/review', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher'], true);
    if (!authorization.ok) return authorization.response;
    if (!database || !publicationReview) {
      return errorResponse(context, 503, 'EVENT_REVIEW_NOT_READY', 'Event review is unavailable');
    }
    try {
      const input = incidentReviewSchema.parse(await context.req.json());
      const review = getPostmortemPublicationReview(
        database,
        context.req.param('id'),
        input.expectedVersion
      );
      const token = publicationReview.create({
        eventId: review.event.id,
        eventVersion: review.event.version,
        notifySubscribers: input.notifySubscribers,
        estimatedRecipients: review.estimatedRecipients,
        principal: authorization.principal,
      });
      return context.json({
        data: {
          postmortem: review.event,
          notifySubscribers: input.notifySubscribers,
          estimatedRecipients: review.estimatedRecipients,
          reviewNonce: token.nonce,
          expiresAt: token.expiresAt,
        },
      });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/postmortems/:id/publish', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher'], true);
    if (!authorization.ok) return authorization.response;
    if (!database || !publicationReview) {
      return errorResponse(context, 503, 'EVENT_REVIEW_NOT_READY', 'Event review is unavailable');
    }
    try {
      const eventId = context.req.param('id');
      const input = incidentPublishSchema.parse(await context.req.json());
      const review = getPostmortemPublicationReview(database, eventId, input.expectedVersion);
      const reviewInput = {
        eventId,
        eventVersion: input.expectedVersion,
        notifySubscribers: input.notifySubscribers,
        estimatedRecipients: review.estimatedRecipients,
        principal: authorization.principal,
      };
      if (!publicationReview.verify(reviewInput, input.reviewNonce)) {
        writeRouteAudit(
          context,
          authorization.principal.userId,
          'failed',
          'PUBLICATION_REVIEW_INVALID'
        );
        return errorResponse(
          context,
          409,
          'PUBLICATION_REVIEW_INVALID',
          'Publication review is invalid, expired, or stale'
        );
      }
      const publication = publishPostmortem(
        database,
        {
          eventId,
          expectedVersion: input.expectedVersion,
          notifySubscribers: input.notifySubscribers,
          expectedRecipients: review.estimatedRecipients,
          piiProtector: piiProtector ?? undefined,
        },
        auditContext(context, authorization.principal)
      );
      return context.json({ data: publication }, 201);
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/subscribers', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Subscriber database is unavailable'
      );
    }
    try {
      const limit = adminListLimitSchema.parse(context.req.query('limit'));
      return context.json({ data: listAdminSubscribers(database, limit) });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/deliveries', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher']);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Delivery database is unavailable');
    }
    try {
      const limit = adminListLimitSchema.parse(context.req.query('limit'));
      return context.json({ data: listAdminDeliveries(database, limit) });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/deliveries/:id/retry', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(context, 503, 'DATABASE_NOT_READY', 'Delivery database is unavailable');
    }
    try {
      const input = deliveryRetrySchema.parse(await context.req.json());
      const delivery = retryAdminDelivery(
        database,
        context.req.param('id'),
        input.expectedState,
        auditContext(context, authorization.principal)
      );
      return context.json({ data: delivery });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/subscribers/:id/suppress', async context => {
    const authorization = await requireAdmin(context, ['owner'], true);
    if (!authorization.ok) return authorization.response;
    if (!database) {
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Subscriber database is unavailable'
      );
    }
    try {
      const input = subscriberSuppressSchema.parse(await context.req.json());
      const subscriber = suppressAdminSubscriber(
        database,
        context.req.param('id'),
        input.expectedState,
        auditContext(context, authorization.principal),
        subscriberTombstones
      );
      return context.json({ data: subscriber });
    } catch (error) {
      return handleEventError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/sources/test', async context => {
    const authorization = await requireAdmin(context, ['owner', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!sourceTest)
      return errorResponse(context, 503, 'SOURCE_TEST_NOT_READY', 'Source testing is unavailable');
    try {
      const input = sourceTestSchema.parse(await context.req.json());
      return context.json({ data: await sourceTest.test(input.source) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return errorResponse(context, 400, 'VALIDATION_FAILED', 'Source configuration is invalid');
      }
      const code =
        typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : null;
      if (code === 'unsupported_page_type') {
        return errorResponse(
          context,
          400,
          'UNSUPPORTED_PAGE_TYPE',
          'This source does not expose a supported public status-page API'
        );
      }
      if (code === 'unsupported_version') {
        return errorResponse(
          context,
          400,
          'UNSUPPORTED_VERSION',
          'This LLM-Mieru API major version is not supported'
        );
      }
      return errorResponse(
        context,
        400,
        'SOURCE_CONNECTION_FAILED',
        'The source connection test failed'
      );
    }
  });

  app.post('/api/v1/admin/config/reload', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (currentSnapshot().mode !== 'file') {
      return errorResponse(
        context,
        409,
        'CONFIG_MODE_NOT_FILE',
        'Configuration reload is available only in file mode'
      );
    }
    if (modeTransitions?.isInFlight()) {
      return errorResponse(
        context,
        409,
        'CONFIG_TRANSITION_IN_PROGRESS',
        'A configuration transition is in progress'
      );
    }
    if (!reloadFileConfig) {
      return errorResponse(
        context,
        503,
        'CONFIG_RELOAD_NOT_READY',
        'Configuration reload is unavailable'
      );
    }
    const result = await reloadFileConfig();
    if (result.outcome === 'failed') {
      writeRouteAudit(
        context,
        authorization.principal.userId,
        'failed',
        result.status.lastErrorCode?.toUpperCase() ?? 'CONFIG_RELOAD_FAILED'
      );
      return errorResponse(
        context,
        409,
        result.status.lastErrorCode?.toUpperCase() ?? 'CONFIG_RELOAD_FAILED',
        'The candidate file did not pass reload validation'
      );
    }
    writeRouteAudit(context, authorization.principal.userId, 'success', null);
    return context.json({ data: result });
  });

  app.get('/api/v1/admin/config/transitions/file-source', async context => {
    const authorization = await requireAdmin(context, ['owner', 'editor']);
    if (!authorization.ok) return authorization.response;
    if (!modeTransitions) {
      return errorResponse(
        context,
        503,
        'CONFIG_TRANSITION_NOT_READY',
        'Configuration transition service is unavailable'
      );
    }
    try {
      const source = await modeTransitions.inspectFileSource();
      return context.json({ data: source });
    } catch (error) {
      return handleConfigTransitionError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/config/transitions/preview', async context => {
    const authorization = await requireAdmin(context, ['owner', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!modeTransitions) {
      return errorResponse(
        context,
        503,
        'CONFIG_TRANSITION_NOT_READY',
        'Configuration transition service is unavailable'
      );
    }
    try {
      const input = configModeTransitionPreviewSchema.parse(await context.req.json());
      const preview = await modeTransitions.preview(
        input,
        auditContext(context, authorization.principal)
      );
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({ data: preview });
    } catch (error) {
      return handleConfigTransitionError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/config/transitions/apply', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!modeTransitions) {
      return errorResponse(
        context,
        503,
        'CONFIG_TRANSITION_NOT_READY',
        'Configuration transition service is unavailable'
      );
    }
    try {
      const input = configModeTransitionApplySchema.parse(await context.req.json());
      const result = await modeTransitions.apply(
        input,
        auditContext(context, authorization.principal)
      );
      writeRouteAudit(context, authorization.principal.userId, 'success', null);
      return context.json({ data: result });
    } catch (error) {
      return handleConfigTransitionError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/config/status', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    const runtime = currentSnapshot();
    const durable = database ? getDurableConfigState(database) : null;
    context.header('Cache-Control', 'no-store');
    return context.json({
      data: {
        mode: runtime.mode,
        revision: runtime.revision,
        contentHash: runtime.contentHash,
        loadedAt: runtime.loadedAt,
        reload: getFileReloadStatus?.() ?? null,
        compatibility: runtime.compatibility ?? null,
        transition: modeTransitions?.status() ?? null,
        fileConfigured: Boolean(modeTransitions?.configuredFilePath ?? runtime.filePath),
        managedBaseRevision: durable?.managedRevision ?? null,
      },
    });
  });

  app.post('/api/v1/admin/sources', async context => {
    const authorization = await requireAdmin(context, ['owner', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database)
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Configuration database is unavailable'
      );
    if (!sourceTest)
      return errorResponse(context, 503, 'SOURCE_TEST_NOT_READY', 'Source testing is unavailable');
    if (currentSnapshot().mode !== 'managed') {
      return errorResponse(
        context,
        409,
        'CONFIG_MODE_READ_ONLY',
        'Sources are writable only in managed mode'
      );
    }
    try {
      const input = sourceCreateSchema.parse(await context.req.json());
      if (!sourceTest.validate(input.source, input.testToken)) {
        return errorResponse(
          context,
          400,
          'SOURCE_TEST_TOKEN_INVALID',
          'Source test token is invalid or expired'
        );
      }
      const revision = mutateManagedConfig(database, {
        expectedRevision: input.expectedRevision,
        audit: auditContext(context, authorization.principal),
        action: 'source.create',
        targetType: 'source',
        targetId: input.source.id,
        mutate: config => ({ ...config, sources: [...config.sources, input.source] }),
      });
      await onManagedRevision?.(revision);
      return context.json({ data: { revision: revision.revision, applyStatus: 'active' } }, 201);
    } catch (error) {
      return handleManagedError(context, error, authorization.principal);
    }
  });

  app.patch('/api/v1/admin/sources/:id', async context => {
    const authorization = await requireAdmin(context, ['owner', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database)
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Configuration database is unavailable'
      );
    if (!sourceTest)
      return errorResponse(context, 503, 'SOURCE_TEST_NOT_READY', 'Source testing is unavailable');
    if (currentSnapshot().mode !== 'managed') {
      return errorResponse(
        context,
        409,
        'CONFIG_MODE_READ_ONLY',
        'Sources are writable only in managed mode'
      );
    }
    try {
      const input = sourcePatchSchema.parse(await context.req.json());
      const id = context.req.param('id');
      const existing = currentSnapshot().config.sources.find(source => source.id === id);
      if (!existing) return errorResponse(context, 404, 'SOURCE_NOT_FOUND', 'Source not found');
      const nextSource = sourceSchema.parse({ ...existing, ...input.patch, id });
      if (!sourceTest.validate(nextSource, input.testToken)) {
        return errorResponse(
          context,
          400,
          'SOURCE_TEST_TOKEN_INVALID',
          'Source test token is invalid or expired'
        );
      }
      const revision = mutateManagedConfig(database, {
        expectedRevision: input.expectedRevision,
        audit: auditContext(context, authorization.principal),
        action: 'source.update',
        targetType: 'source',
        targetId: id,
        mutate: config => ({
          ...config,
          sources: config.sources.map(source => (source.id === id ? nextSource : source)),
        }),
      });
      await onManagedRevision?.(revision);
      return context.json({ data: { revision: revision.revision, applyStatus: 'active' } });
    } catch (error) {
      return handleManagedError(context, error, authorization.principal);
    }
  });

  app.get('/api/v1/admin/pages', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    return context.json({ data: currentSnapshot().config.pages });
  });

  app.post('/api/v1/admin/pages', async context => {
    const authorization = await requireAdmin(context, ['owner', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database)
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Configuration database is unavailable'
      );
    if (currentSnapshot().mode !== 'managed') {
      return errorResponse(
        context,
        409,
        'CONFIG_MODE_READ_ONLY',
        'Pages are writable only in managed mode'
      );
    }
    try {
      const input = pageCreateSchema.parse(await context.req.json());
      const revision = mutateManagedConfig(database, {
        expectedRevision: input.expectedRevision,
        audit: auditContext(context, authorization.principal),
        action: 'page.create',
        targetType: 'page',
        targetId: input.page.id,
        mutate: config => ({ ...config, pages: [...config.pages, input.page] }),
      });
      await onManagedRevision?.(revision);
      return context.json({ data: { revision: revision.revision, applyStatus: 'active' } }, 201);
    } catch (error) {
      return handleManagedError(context, error, authorization.principal);
    }
  });

  app.patch('/api/v1/admin/pages/:id', async context => {
    const authorization = await requireAdmin(context, ['owner', 'editor'], true);
    if (!authorization.ok) return authorization.response;
    if (!database)
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Configuration database is unavailable'
      );
    if (currentSnapshot().mode !== 'managed') {
      return errorResponse(
        context,
        409,
        'CONFIG_MODE_READ_ONLY',
        'Pages are writable only in managed mode'
      );
    }
    try {
      const input = pagePatchSchema.parse(await context.req.json());
      const id = context.req.param('id');
      if (!currentSnapshot().config.pages.some(page => page.id === id)) {
        return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
      }
      const revision = mutateManagedConfig(database, {
        expectedRevision: input.expectedRevision,
        audit: auditContext(context, authorization.principal),
        action: 'page.update',
        targetType: 'page',
        targetId: id,
        mutate: config => ({
          ...config,
          pages: config.pages.map(page => (page.id === id ? { ...page, ...input.patch } : page)),
        }),
      });
      await onManagedRevision?.(revision);
      return context.json({ data: { revision: revision.revision, applyStatus: 'active' } });
    } catch (error) {
      return handleManagedError(context, error, authorization.principal);
    }
  });

  app.post('/api/v1/admin/config/revisions/:id/rollback', async context => {
    const authorization = await requireAdmin(context, ['owner'], true, true);
    if (!authorization.ok) return authorization.response;
    if (!database)
      return errorResponse(
        context,
        503,
        'DATABASE_NOT_READY',
        'Configuration database is unavailable'
      );
    if (currentSnapshot().mode !== 'managed') {
      return errorResponse(
        context,
        409,
        'CONFIG_MODE_READ_ONLY',
        'Rollback is available only in managed mode'
      );
    }
    if (modeTransitions?.isInFlight()) {
      return errorResponse(
        context,
        409,
        'CONFIG_TRANSITION_IN_PROGRESS',
        'A configuration transition is in progress'
      );
    }
    try {
      const input = rollbackSchema.parse(await context.req.json());
      const targetRevision = z.coerce.number().int().positive().parse(context.req.param('id'));
      const revision = rollbackManagedConfig(database, {
        expectedRevision: input.expectedRevision,
        targetRevision,
        audit: auditContext(context, authorization.principal),
        action: 'config.rollback',
        targetType: 'config_revision',
      });
      await onManagedRevision?.(revision);
      return context.json({ data: { revision: revision.revision, applyStatus: 'active' } });
    } catch (error) {
      return handleManagedError(context, error, authorization.principal);
    }
  });
};

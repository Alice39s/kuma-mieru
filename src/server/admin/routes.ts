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
import { listManagedRevisions, type ConfigRevision } from '../config/repository.js';
import {
  sourcePatchSchema as sourcePatchValueSchema,
  sourceSchema,
  statusPageSchema,
} from '../config/schema.js';
import type { RuntimeConfigSnapshot } from '../config/runtime-config.js';
import type { SecretStore } from '../secrets/store.js';
import {
  appendIncidentUpdate,
  createIncident,
  getPublicationReview,
  listIncidents,
  publishIncident,
} from '../events/repository.js';
import { createPublicationReviewService } from '../events/review.js';
import {
  incidentCreateSchema,
  incidentPublishSchema,
  incidentReviewSchema,
  incidentUpdateSchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
  noticeCreateSchema,
  noticeUpdateSchema,
} from '../events/schemas.js';
import {
  appendMaintenanceUpdate,
  createMaintenance,
  getMaintenancePublicationReview,
  listMaintenances,
  publishMaintenance,
} from '../events/maintenance-repository.js';
import {
  appendNoticeUpdate,
  createNotice,
  getNoticePublicationReview,
  listNotices,
  publishNotice,
} from '../events/notice-repository.js';
import { createPiiProtector } from '../subscriptions/crypto.js';

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
const idempotencyKeySchema = z.string().min(8).max(200);

export interface AdminRouteOptions {
  database?: Database.Database;
  auth?: KumaAuth;
  authSecret?: string;
  trustedOrigins: string[];
  sourceTest?: SourceTestService;
  secretStore?: SecretStore;
  currentSnapshot: () => RuntimeConfigSnapshot;
  onManagedRevision?: (revision: ConfigRevision) => void | Promise<void>;
  getFileReloadStatus?: () => FileReloadStatus;
  reloadFileConfig?: () => Promise<FileReloadResult>;
}

export const registerAdminRoutes = (
  app: Hono<AppEnvironment>,
  {
    database,
    auth,
    authSecret,
    trustedOrigins,
    sourceTest,
    secretStore,
    currentSnapshot,
    onManagedRevision,
    getFileReloadStatus,
    reloadFileConfig,
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

  app.use(
    '/api/v1/admin/*',
    bodyLimit({
      maxSize: 256 * 1024,
      onError: context =>
        errorResponse(context, 413, 'BODY_TOO_LARGE', 'Admin JSON body exceeds 256 KiB'),
    })
  );

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

  app.get('/api/v1/admin/sources', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    return context.json({ data: currentSnapshot().config.sources });
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
    const status =
      code === 'event_not_found'
        ? 404
        : code.includes('conflict') ||
            code.includes('already') ||
            code.includes('stale') ||
            code.includes('reused')
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

  app.get('/api/v1/admin/config/status', async context => {
    const authorization = await requireAdmin(context, ['owner', 'publisher', 'editor', 'viewer']);
    if (!authorization.ok) return authorization.response;
    const runtime = currentSnapshot();
    context.header('Cache-Control', 'no-store');
    return context.json({
      data: {
        mode: runtime.mode,
        revision: runtime.revision,
        contentHash: runtime.contentHash,
        loadedAt: runtime.loadedAt,
        reload: getFileReloadStatus?.() ?? null,
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

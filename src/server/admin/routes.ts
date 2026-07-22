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
import { listManagedRevisions, type ConfigRevision } from '../config/repository.js';
import { sourceSchema, statusPageSchema } from '../config/schema.js';
import type { RuntimeConfigSnapshot } from '../config/runtime-config.js';

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
  patch: sourceSchema.partial().omit({ id: true }),
  testToken: z.string().min(1),
});

export interface AdminRouteOptions {
  database?: Database.Database;
  auth?: KumaAuth;
  authSecret?: string;
  trustedOrigins: string[];
  sourceTest?: SourceTestService;
  currentSnapshot: () => RuntimeConfigSnapshot;
  onManagedRevision?: (revision: ConfigRevision) => void | Promise<void>;
}

export const registerAdminRoutes = (
  app: Hono<AppEnvironment>,
  {
    database,
    auth,
    authSecret,
    trustedOrigins,
    sourceTest,
    currentSnapshot,
    onManagedRevision,
  }: AdminRouteOptions
) => {
  const writeAttemptAudit = (
    context: Context<AppEnvironment>,
    actorId: string,
    result: 'denied' | 'failed',
    errorCode: string
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
      writeAttemptAudit(context, principal.userId, 'denied', 'FORBIDDEN');
      return {
        ok: false as const,
        response: errorResponse(context, 403, 'FORBIDDEN', 'Role does not permit this action'),
      };
    }
    if (recentAuthentication && !isRecentlyAuthenticated(principal)) {
      writeAttemptAudit(context, principal.userId, 'denied', 'REAUTH_REQUIRED');
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
        writeAttemptAudit(context, principal.userId, 'denied', 'UNTRUSTED_ORIGIN');
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
        writeAttemptAudit(context, principal.userId, 'denied', 'CSRF_TOKEN_INVALID');
        return {
          ok: false as const,
          response: errorResponse(context, 403, 'CSRF_TOKEN_INVALID', 'CSRF token is invalid'),
        };
      }
      if (!context.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
        writeAttemptAudit(context, principal.userId, 'denied', 'JSON_REQUIRED');
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
      writeAttemptAudit(context, principal.userId, 'failed', 'VALIDATION_FAILED');
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
    writeAttemptAudit(context, principal.userId, 'failed', code.toUpperCase());
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
      return errorResponse(
        context,
        400,
        'SOURCE_CONNECTION_FAILED',
        'The source connection test failed'
      );
    }
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

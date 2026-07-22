import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import type { SourceSnapshotState } from './adapters/source-store.js';
import type { SourceTestService } from './adapters/source-test.js';
import { registerAdminRoutes } from './admin/routes.js';
import { errorResponse, type AppEnvironment } from './api/errors.js';
import type { KumaAuth } from './auth/auth.js';
import type { BootstrapService } from './auth/bootstrap.js';
import type { ConfigRevision } from './config/repository.js';
import type { CanonicalConfig } from './config/schema.js';
import type { RuntimeConfigSnapshot } from './config/runtime-config.js';

export interface AppOptions {
  snapshot: RuntimeConfigSnapshot;
  schemaVersion: number;
  buildVersion: string;
  publicDirectory?: string;
  startedAt?: number;
  loadPageSnapshots?: (page: CanonicalConfig['pages'][number]) => SourceSnapshotState[];
  getRuntimeSnapshot?: () => RuntimeConfigSnapshot;
  database?: Database.Database;
  auth?: KumaAuth;
  authSecret?: string;
  trustedOrigins?: string[];
  onManagedRevision?: (revision: ConfigRevision) => void | Promise<void>;
  bootstrap?: BootstrapService;
  sourceTest?: SourceTestService;
}

export const createApp = ({
  snapshot,
  schemaVersion,
  buildVersion,
  publicDirectory,
  startedAt = Date.now(),
  loadPageSnapshots,
  getRuntimeSnapshot,
  database,
  auth,
  authSecret,
  trustedOrigins = [],
  onManagedRevision,
  bootstrap,
  sourceTest,
}: AppOptions) => {
  const app = new Hono<AppEnvironment>();
  const currentSnapshot = () => getRuntimeSnapshot?.() ?? snapshot;

  app.use('*', secureHeaders());
  app.use('*', async (context, next) => {
    const requestId = context.req.header('x-request-id')?.slice(0, 128) || randomUUID();
    context.set('requestId', requestId);
    await next();
    context.header('X-Request-Id', requestId);
  });

  app.use(
    '/api/v1/setup/*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: context =>
        errorResponse(context, 413, 'BODY_TOO_LARGE', 'Setup body exceeds 64 KiB'),
    })
  );

  app.on(['GET', 'POST'], '/api/auth/*', context =>
    auth
      ? auth.handler(context.req.raw)
      : errorResponse(context, 503, 'AUTH_NOT_READY', 'Authentication is not configured')
  );

  app.get('/api/v1/setup/status', context =>
    context.json({
      data: bootstrap?.status() ?? { required: false, available: false, expiresAt: null },
    })
  );

  app.post('/api/v1/setup/owner', async context => {
    if (!bootstrap)
      return errorResponse(context, 503, 'BOOTSTRAP_NOT_READY', 'Owner bootstrap is unavailable');
    if (!context.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
      return errorResponse(context, 415, 'JSON_REQUIRED', 'Owner bootstrap requires JSON');
    }
    try {
      const owner = await bootstrap.complete(await context.req.json(), context.get('requestId'));
      return context.json({ data: owner }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return errorResponse(context, 400, 'VALIDATION_FAILED', 'Owner input is invalid');
      }
      const code =
        typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'bootstrap_failed';
      const status = code === 'bootstrap_closed' ? 404 : code === 'bootstrap_conflict' ? 409 : 403;
      return errorResponse(
        context,
        status,
        code.toUpperCase(),
        'Owner bootstrap could not be completed'
      );
    }
  });

  app.get('/health/live', context => context.json({ status: 'ok' }));
  app.get('/health/ready', context =>
    context.json({ status: 'ok', schemaVersion, configMode: currentSnapshot().mode })
  );
  app.get('/api/health', context => {
    context.header('Cache-Control', 'no-store');
    return context.json({ status: 'ok', uptime: Math.floor((Date.now() - startedAt) / 1000) });
  });

  app.get('/api/v1/meta', context => {
    const runtime = currentSnapshot();
    context.header('Cache-Control', 'no-store');
    return context.json({
      version: buildVersion,
      schemaVersion,
      config: {
        mode: runtime.mode,
        revision: runtime.revision,
        contentHash: runtime.contentHash,
        loadedAt: runtime.loadedAt,
      },
      capabilities: {
        managedConfig: runtime.mode === 'managed',
        fileConfig: runtime.mode === 'file',
        legacyEnvironment: runtime.mode === 'compatibility',
        sourceAdapters: ['uptime-kuma'],
      },
    });
  });

  app.get('/api/v1/public/pages', context =>
    context.json({
      data: currentSnapshot().config.pages.map(page => ({
        id: page.id,
        slug: page.slug,
        title: page.title,
        sourceRefs: page.sourceRefs,
      })),
    })
  );

  app.get('/api/v1/public/pages/:slug/snapshot', context => {
    const runtime = currentSnapshot();
    const slug = context.req.param('slug');
    const page = runtime.config.pages.find(
      candidate => candidate.slug === slug || candidate.id === slug
    );
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    const data = loadPageSnapshots?.(page) ?? [];
    if (data.length === 0) {
      context.header('Cache-Control', 'no-store');
      context.header('Retry-After', '30');
      return errorResponse(
        context,
        503,
        'SOURCE_SNAPSHOT_UNAVAILABLE',
        'No normalized source snapshot is available yet'
      );
    }
    const partial = data.some(item => item.health.stale) || data.length < page.sourceRefs.length;
    context.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    return context.json({ data, meta: { status: partial ? 'partial' : 'ok' } });
  });

  registerAdminRoutes(app, {
    database,
    auth,
    authSecret,
    trustedOrigins,
    sourceTest,
    currentSnapshot,
    onManagedRevision,
  });

  app.notFound(context => {
    if (context.req.path.startsWith('/api/')) {
      return errorResponse(context, 404, 'NOT_FOUND', 'API route not found');
    }
    return context.text('Not found', 404);
  });

  app.onError((error, context) => {
    console.error('Unhandled request error', { message: error.message });
    return errorResponse(context, 500, 'INTERNAL_ERROR', 'The request could not be completed');
  });

  if (publicDirectory) {
    const root = resolve(publicDirectory);
    app.use('/assets/*', async (context, next) => {
      await next();
      if (context.res.status < 400) {
        context.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    });
    app.use('/assets/*', serveStatic({ root }));
    app.get('*', async (context, next) => {
      try {
        await access(resolve(root, 'index.html'));
        return serveStatic({ root, path: 'index.html' })(context, next);
      } catch {
        return next();
      }
    });
  }

  return app;
};

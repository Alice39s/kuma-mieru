import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type Database from 'better-sqlite3';
import { Hono, type Context } from 'hono';
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
import { getPublishedIncident, listPublishedIncidents } from './events/repository.js';
import { feedEtag, renderAtom, renderRss } from './events/feeds.js';
import { createPiiProtector } from './subscriptions/crypto.js';
import { createSubscriptionNonceService } from './subscriptions/nonce.js';
import {
  confirmEmailSubscription,
  inspectSubscriptionToken,
  requestEmailSubscription,
  unsubscribeEmail,
  updateEmailSubscription,
} from './subscriptions/repository.js';
import { subscriptionManageSchema, subscriptionRequestSchema } from './subscriptions/schemas.js';

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
  const piiProtector = authSecret ? createPiiProtector(authSecret) : null;
  const subscriptionNonce = authSecret ? createSubscriptionNonceService(authSecret) : null;
  const findPage = (slug: string) =>
    currentSnapshot().config.pages.find(
      candidate => candidate.slug === slug || candidate.id === slug
    );

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

  app.use(
    '/api/v1/public/*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: context =>
        errorResponse(context, 413, 'BODY_TOO_LARGE', 'Public request body exceeds 64 KiB'),
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
        sourceAdapters: ['uptime-kuma', 'better-stack'],
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

  app.get('/api/v1/public/pages/:slug', context => {
    const page = findPage(context.req.param('slug'));
    return page
      ? context.json({ data: page })
      : errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
  });

  app.get('/api/v1/public/pages/:slug/incidents', context => {
    const page = findPage(context.req.param('slug'));
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    context.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    return context.json({ data: database ? listPublishedIncidents(database, page.id) : [] });
  });

  app.get('/api/v1/public/pages/:slug/incidents/:id', context => {
    const page = findPage(context.req.param('slug'));
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    const data = database ? getPublishedIncident(database, page.id, context.req.param('id')) : [];
    if (data.length === 0) {
      return errorResponse(context, 404, 'INCIDENT_NOT_FOUND', 'Published incident not found');
    }
    context.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    return context.json({ data });
  });

  const renderFeed = (context: Context<AppEnvironment>, format: 'rss' | 'atom') => {
    const slug = context.req.param('slug');
    if (!slug) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    const page = findPage(slug);
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    const items = database ? listPublishedIncidents(database, page.id) : [];
    const etag = feedEtag(items);
    if (context.req.header('if-none-match') === etag) return context.body(null, 304);
    const baseUrl =
      currentSnapshot().config.server.publicBaseUrl ?? new URL(context.req.url).origin;
    const body =
      format === 'rss'
        ? renderRss({ baseUrl, pageSlug: page.slug, pageTitle: page.title, items })
        : renderAtom({ baseUrl, pageSlug: page.slug, pageTitle: page.title, items });
    context.header(
      'Content-Type',
      format === 'rss'
        ? 'application/rss+xml; charset=utf-8'
        : 'application/atom+xml; charset=utf-8'
    );
    context.header('ETag', etag);
    context.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    return context.body(body);
  };

  app.get('/status/:slug/rss.xml', context => renderFeed(context, 'rss'));
  app.get('/status/:slug/atom.xml', context => renderFeed(context, 'atom'));

  const genericSubscriptionResponse = (context: Context<AppEnvironment>) =>
    context.json(
      {
        data: {
          accepted: true,
          message: 'If the address can be subscribed, a confirmation message will be sent.',
        },
      },
      202
    );
  const setTokenPageHeaders = (context: Context<AppEnvironment>) => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    context.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"
    );
  };

  app.get('/api/v1/public/pages/:slug/subscriptions/email/nonce', context => {
    const page = findPage(context.req.param('slug'));
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    if (!subscriptionNonce) {
      return errorResponse(
        context,
        503,
        'SUBSCRIPTIONS_NOT_READY',
        'Email subscriptions are unavailable'
      );
    }
    context.header('Cache-Control', 'no-store');
    return context.json({ data: subscriptionNonce.create(page.id) });
  });

  app.post('/api/v1/public/pages/:slug/subscriptions/email', async context => {
    const page = findPage(context.req.param('slug'));
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    if (!database || !piiProtector || !subscriptionNonce) {
      return errorResponse(
        context,
        503,
        'SUBSCRIPTIONS_NOT_READY',
        'Email subscriptions are unavailable'
      );
    }
    try {
      const input = subscriptionRequestSchema.parse(await context.req.json());
      if (input.website || !subscriptionNonce.verify(page.id, input.nonce)) {
        return genericSubscriptionResponse(context);
      }
      requestEmailSubscription(database, piiProtector, page.id, input);
      return genericSubscriptionResponse(context);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return errorResponse(
          context,
          400,
          'VALIDATION_FAILED',
          'Subscription request is invalid',
          error.issues
        );
      }
      console.error('Subscription request failed', { requestId: context.get('requestId') });
      return genericSubscriptionResponse(context);
    }
  });

  app.get('/api/v1/public/subscriptions/confirm/:token', context => {
    setTokenPageHeaders(context);
    const view =
      database && piiProtector
        ? inspectSubscriptionToken(database, piiProtector, context.req.param('token'), 'confirm')
        : null;
    return view
      ? context.json({ data: view })
      : errorResponse(context, 404, 'SUBSCRIPTION_TOKEN_INVALID', 'Subscription token is invalid');
  });

  app.post('/api/v1/public/subscriptions/confirm/:token', context => {
    setTokenPageHeaders(context);
    if (!database || !piiProtector) {
      return errorResponse(
        context,
        503,
        'SUBSCRIPTIONS_NOT_READY',
        'Email subscriptions are unavailable'
      );
    }
    try {
      return context.json({
        data: confirmEmailSubscription(database, piiProtector, context.req.param('token')),
      });
    } catch {
      return errorResponse(
        context,
        404,
        'SUBSCRIPTION_TOKEN_INVALID',
        'Subscription token is invalid'
      );
    }
  });

  app.get('/api/v1/public/subscriptions/manage/:token', context => {
    setTokenPageHeaders(context);
    const view =
      database && piiProtector
        ? inspectSubscriptionToken(database, piiProtector, context.req.param('token'), 'manage')
        : null;
    return view?.state === 'active'
      ? context.json({ data: view })
      : errorResponse(context, 404, 'SUBSCRIPTION_TOKEN_INVALID', 'Subscription token is invalid');
  });

  app.patch('/api/v1/public/subscriptions/manage/:token', async context => {
    setTokenPageHeaders(context);
    if (!database || !piiProtector) {
      return errorResponse(
        context,
        503,
        'SUBSCRIPTIONS_NOT_READY',
        'Email subscriptions are unavailable'
      );
    }
    try {
      const input = subscriptionManageSchema.parse(await context.req.json());
      return context.json({
        data: updateEmailSubscription(database, piiProtector, context.req.param('token'), input),
      });
    } catch (error) {
      return errorResponse(
        context,
        error instanceof z.ZodError ? 400 : 404,
        error instanceof z.ZodError ? 'VALIDATION_FAILED' : 'SUBSCRIPTION_TOKEN_INVALID',
        error instanceof z.ZodError
          ? 'Subscription scope is invalid'
          : 'Subscription token is invalid',
        error instanceof z.ZodError ? error.issues : undefined
      );
    }
  });

  app.post('/api/v1/public/subscriptions/unsubscribe/:token', context => {
    setTokenPageHeaders(context);
    if (!database || !piiProtector) {
      return errorResponse(
        context,
        503,
        'SUBSCRIPTIONS_NOT_READY',
        'Email subscriptions are unavailable'
      );
    }
    try {
      return context.json({
        data: unsubscribeEmail(database, piiProtector, context.req.param('token')),
      });
    } catch {
      return errorResponse(
        context,
        404,
        'SUBSCRIPTION_TOKEN_INVALID',
        'Subscription token is invalid'
      );
    }
  });

  app.get('/api/v1/public/pages/:slug/snapshot', context => {
    const page = findPage(context.req.param('slug'));
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

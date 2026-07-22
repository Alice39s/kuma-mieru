import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { SourceSnapshotState } from './adapters/source-store.js';
import type { CanonicalConfig } from './config/schema.js';
import type { RuntimeConfigSnapshot } from './config/runtime-config.js';

export interface AppOptions {
  snapshot: RuntimeConfigSnapshot;
  schemaVersion: number;
  buildVersion: string;
  publicDirectory?: string;
  startedAt?: number;
  loadPageSnapshots?: (page: CanonicalConfig['pages'][number]) => SourceSnapshotState[];
}

export const createApp = ({
  snapshot,
  schemaVersion,
  buildVersion,
  publicDirectory,
  startedAt = Date.now(),
  loadPageSnapshots,
}: AppOptions) => {
  const app = new Hono();
  app.use('*', secureHeaders());

  app.get('/health/live', context => context.json({ status: 'ok' }));
  app.get('/health/ready', context =>
    context.json({ status: 'ok', schemaVersion, configMode: snapshot.mode })
  );
  app.get('/api/health', context => {
    context.header('Cache-Control', 'no-store');
    return context.json({ status: 'ok', uptime: Math.floor((Date.now() - startedAt) / 1000) });
  });

  app.get('/api/v1/meta', context => {
    context.header('Cache-Control', 'no-store');
    return context.json({
      version: buildVersion,
      schemaVersion,
      config: {
        mode: snapshot.mode,
        revision: snapshot.revision,
        contentHash: snapshot.contentHash,
        loadedAt: snapshot.loadedAt,
      },
      capabilities: {
        managedConfig: snapshot.mode === 'managed',
        fileConfig: snapshot.mode === 'file',
        legacyEnvironment: snapshot.mode === 'compatibility',
        sourceAdapters: ['uptime-kuma'],
      },
    });
  });

  app.get('/api/v1/public/pages', context =>
    context.json({
      data: snapshot.config.pages.map(page => ({
        id: page.id,
        slug: page.slug,
        title: page.title,
        sourceRefs: page.sourceRefs,
      })),
    })
  );

  app.get('/api/v1/public/pages/:slug/snapshot', context => {
    const slug = context.req.param('slug');
    const page = snapshot.config.pages.find(
      candidate => candidate.slug === slug || candidate.id === slug
    );
    if (!page) {
      return context.json(
        { error: { code: 'PAGE_NOT_FOUND', message: 'Status page not found' } },
        404
      );
    }
    const data = loadPageSnapshots?.(page) ?? [];
    if (data.length === 0) {
      context.header('Cache-Control', 'no-store');
      context.header('Retry-After', '30');
      return context.json(
        {
          error: {
            code: 'SOURCE_SNAPSHOT_UNAVAILABLE',
            message: 'No normalized source snapshot is available yet',
          },
        },
        503
      );
    }
    const partial = data.some(item => item.health.stale) || data.length < page.sourceRefs.length;
    context.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    return context.json({ data, meta: { status: partial ? 'partial' : 'ok' } });
  });

  app.notFound(context => {
    if (context.req.path.startsWith('/api/')) {
      return context.json({ error: { code: 'NOT_FOUND', message: 'API route not found' } }, 404);
    }
    return context.text('Not found', 404);
  });

  app.onError((error, context) => {
    console.error('Unhandled request error', { message: error.message });
    return context.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed' } },
      500
    );
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

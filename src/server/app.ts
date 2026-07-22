import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { RuntimeConfigSnapshot } from './config/runtime-config.js';

export interface AppOptions {
  snapshot: RuntimeConfigSnapshot;
  schemaVersion: number;
  buildVersion: string;
  publicDirectory?: string;
  startedAt?: number;
}

export const createApp = ({
  snapshot,
  schemaVersion,
  buildVersion,
  publicDirectory,
  startedAt = Date.now(),
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

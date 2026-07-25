import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type Database from 'better-sqlite3';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import type { SourceSnapshotState } from './adapters/source-store.js';
import type { MetricWindowState } from './adapters/metric-store.js';
import type { MethodologyState } from './adapters/methodology-store.js';
import type { SourceTestService } from './adapters/source-test.js';
import { registerAdminRoutes } from './admin/routes.js';
import { errorResponse, type AppEnvironment } from './api/errors.js';
import type { KumaAuth } from './auth/auth.js';
import type { BootstrapService } from './auth/bootstrap.js';
import type { ConfigRevision } from './config/repository.js';
import type { FileReloadResult, FileReloadStatus } from './config/file-reloader.js';
import type { CanonicalConfig } from './config/schema.js';
import type { RuntimeConfigSnapshot } from './config/runtime-config.js';
import type { SecretStore } from './secrets/store.js';
import type { BackupService } from './db/backup.js';
import type { DeliveryRuntimeStatus } from './delivery/runtime.js';
import type { SmtpTestService } from './delivery/smtp-config.js';
import type { RetentionService } from './retention/service.js';
import type { SubscriberTombstoneStore } from './retention/tombstone-store.js';
import type { ReleaseManifest } from './release/manifest.js';
import type { NormalizedStatus } from './adapters/types.js';
import type { OgImageInput, OgImageService, OgView } from './og/types.js';
import {
  getPublishedIncident,
  listPublishedEvents,
  listPublishedIncidents,
} from './events/repository.js';
import { feedEtag, renderAtom, renderRss } from './events/feeds.js';
import {
  getPublishedMaintenance,
  listPublishedMaintenances,
} from './events/maintenance-repository.js';
import { listPublishedNotices } from './events/notice-repository.js';
import { listPublishedPostmortems } from './events/postmortem-repository.js';
import {
  getMirroredEventTimeline,
  listMirroredEvents,
  type MirroredEventSourceFilter,
} from './events/mirrored-repository.js';
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

const publicMetricQuerySchema = z.object({
  metric: z.string().min(1).max(128),
  source: z.string().min(1).max(128).optional(),
  window: z.enum(['5m', '1h', '1d', '7d', '30d']).default('5m'),
});

const statusRank: Record<NormalizedStatus, number> = {
  operational: 0,
  pending: 1,
  paused: 2,
  maintenance: 3,
  degraded: 4,
  unknown: 5,
  partial_outage: 6,
  major_outage: 7,
};

const worstStatus = (statuses: NormalizedStatus[]) =>
  statuses.reduce<NormalizedStatus>(
    (worst, status) => (statusRank[status] > statusRank[worst] ? status : worst),
    statuses.length > 0 ? 'operational' : 'pending'
  );

const etagMatches = (header: string | undefined, etag: string) =>
  header
    ?.split(',')
    .map(value => value.trim().replace(/^W\//u, ''))
    .some(value => value === '*' || value === etag) ?? false;

export interface AppOptions {
  snapshot: RuntimeConfigSnapshot;
  schemaVersion: number;
  buildVersion: string;
  publicDirectory?: string;
  startedAt?: number;
  loadPageSnapshots?: (page: CanonicalConfig['pages'][number]) => SourceSnapshotState[];
  loadPageMetricWindows?: (page: CanonicalConfig['pages'][number]) => MetricWindowState[];
  loadPageMethodologies?: (page: CanonicalConfig['pages'][number]) => MethodologyState[];
  getRuntimeSnapshot?: () => RuntimeConfigSnapshot;
  database?: Database.Database;
  auth?: KumaAuth;
  authSecret?: string;
  trustedOrigins?: string[];
  onManagedRevision?: (revision: ConfigRevision) => void | Promise<void>;
  getFileReloadStatus?: () => FileReloadStatus;
  reloadFileConfig?: () => Promise<FileReloadResult>;
  bootstrap?: BootstrapService;
  sourceTest?: SourceTestService;
  smtpTest?: SmtpTestService;
  getDeliveryRuntimeStatus?: () => DeliveryRuntimeStatus;
  isEmailDeliveryEnabled?: () => boolean;
  secretStore?: SecretStore;
  backupService?: BackupService;
  retentionService?: RetentionService;
  subscriberTombstones?: SubscriberTombstoneStore;
  isRuntimeLockHeld?: () => boolean;
  releaseManifest?: ReleaseManifest | null;
  ogImageService?: OgImageService;
}

export const createApp = ({
  snapshot,
  schemaVersion,
  buildVersion,
  publicDirectory,
  startedAt = Date.now(),
  loadPageSnapshots,
  loadPageMetricWindows,
  loadPageMethodologies,
  getRuntimeSnapshot,
  database,
  auth,
  authSecret,
  trustedOrigins = [],
  onManagedRevision,
  getFileReloadStatus,
  reloadFileConfig,
  bootstrap,
  sourceTest,
  smtpTest,
  getDeliveryRuntimeStatus,
  isEmailDeliveryEnabled = () => false,
  secretStore,
  backupService,
  retentionService,
  subscriberTombstones,
  isRuntimeLockHeld = () => true,
  releaseManifest = null,
  ogImageService,
}: AppOptions) => {
  const app = new Hono<AppEnvironment>();
  const currentSnapshot = () => getRuntimeSnapshot?.() ?? snapshot;
  const piiProtector = authSecret ? createPiiProtector(authSecret) : null;
  const subscriptionNonce = authSecret ? createSubscriptionNonceService(authSecret) : null;
  const findPage = (slug: string) =>
    currentSnapshot().config.pages.find(
      candidate => candidate.slug === slug || candidate.id === slug
    );
  const findLegacyPage = (requested: string | undefined) =>
    (requested ? findPage(requested) : null) ?? currentSnapshot().config.pages[0] ?? null;
  const ogInputForPage = (page: CanonicalConfig['pages'][number], view: OgView): OgImageInput => {
    const snapshots = loadPageSnapshots?.(page) ?? [];
    const stale = snapshots.length === 0 || snapshots.some(item => item.health.stale);
    const observedStatus = worstStatus(snapshots.map(item => item.snapshot.status));
    return {
      pageId: page.id,
      pageSlug: page.slug,
      title: page.title,
      description: page.description ?? '',
      status: stale && observedStatus === 'operational' ? 'unknown' : observedStatus,
      stale,
      view,
      services: snapshots
        .flatMap(item => item.snapshot.services)
        .map(service => ({ name: service.name, status: service.status })),
    };
  };
  const mirroredFiltersForPage = (
    page: CanonicalConfig['pages'][number]
  ): MirroredEventSourceFilter[] =>
    page.sourceRefs.flatMap(sourceId => {
      const source = currentSnapshot().config.sources.find(candidate => candidate.id === sourceId);
      return source?.pageIds.map(pageId => ({ sourceId, pageId })) ?? [];
    });
  const publicMirroredEvent = <Event extends { source: { url: string } }>(event: Event) => ({
    ...event,
    source: { ...event.source, url: null },
  });
  const setLegacyHeaders = (context: Context<AppEnvironment>, available: boolean) => {
    context.header('Deprecation', 'true');
    context.header('Link', '</about#v1-compatibility>; rel="deprecation"');
    if (available) {
      context.header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
    } else {
      context.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      context.header('Pragma', 'no-cache');
      context.header('Expires', '0');
    }
  };

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

  const canonicalRedirect = (context: Context<AppEnvironment>, path: string) => {
    const url = new URL(context.req.url);
    return context.redirect(`${path}${url.search}`, 308);
  };
  const renderOg = async (
    context: Context<AppEnvironment>,
    page: CanonicalConfig['pages'][number],
    view: OgView
  ) => {
    if (!ogImageService) {
      return errorResponse(
        context,
        503,
        'OG_RENDERER_NOT_READY',
        'OG image rendering is unavailable'
      );
    }
    const result = await ogImageService.render(ogInputForPage(page, view));
    const headers = {
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
      'Content-Type': 'image/png',
      ETag: result.etag,
      'X-Kuma-Mieru-OG': result.source,
    };
    if (etagMatches(context.req.header('if-none-match'), result.etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(Uint8Array.from(result.bytes).buffer, { status: 200, headers });
  };

  if (ogImageService) {
    app.get('/opengraph.png', context => {
      const page = currentSnapshot().config.pages[0];
      return page
        ? renderOg(context, page, 'overview')
        : errorResponse(context, 404, 'PAGE_NOT_FOUND', 'No public status page is configured');
    });
    app.get('/api/v1/public/pages/:slug/opengraph.png', context => {
      const page = findPage(context.req.param('slug'));
      return page
        ? renderOg(context, page, 'overview')
        : errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    });
    app.get('/status/:slug/opengraph.png', context => {
      const page = findPage(context.req.param('slug'));
      return page ? renderOg(context, page, 'overview') : context.notFound();
    });
    app.get('/status/:slug/metrics/opengraph.png', context => {
      const page = findPage(context.req.param('slug'));
      return page ? renderOg(context, page, 'metrics') : context.notFound();
    });
    app.get('/status/:slug/methodology/opengraph.png', context => {
      const page = findPage(context.req.param('slug'));
      return page ? renderOg(context, page, 'methodology') : context.notFound();
    });
    app.get('/:pageId/opengraph.png', context => {
      const page = findPage(context.req.param('pageId'));
      return page ? renderOg(context, page, 'overview') : context.notFound();
    });
  }

  app.get('/status/:slug', context => {
    const page = findPage(context.req.param('slug'));
    return page
      ? canonicalRedirect(context, `/status/${encodeURIComponent(page.slug)}/`)
      : context.notFound();
  });
  app.get('/status/:slug/metrics', context => {
    const page = findPage(context.req.param('slug'));
    return page
      ? canonicalRedirect(context, `/status/${encodeURIComponent(page.slug)}/metrics/`)
      : context.notFound();
  });
  app.get('/status/:slug/methodology', context => {
    const page = findPage(context.req.param('slug'));
    return page
      ? canonicalRedirect(context, `/status/${encodeURIComponent(page.slug)}/methodology/`)
      : context.notFound();
  });

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
    isRuntimeLockHeld()
      ? context.json({
          status: 'ok',
          schemaVersion,
          configMode: currentSnapshot().mode,
          runtimeOwnership: 'exclusive',
        })
      : errorResponse(
          context,
          503,
          'RUNTIME_LOCK_NOT_HELD',
          'Runtime does not own the data directory'
        )
  );
  app.get('/api/health', context => {
    context.header('Cache-Control', 'no-store');
    return context.json({ status: 'ok', uptime: Math.floor((Date.now() - startedAt) / 1000) });
  });

  app.get('/api/config', context => {
    const page = findLegacyPage(context.req.query('pageId'));
    const pageSnapshots = page ? (loadPageSnapshots?.(page) ?? []) : [];
    const available = Boolean(page && pageSnapshots.length > 0);
    setLegacyHeaders(context, available);
    const incidents = pageSnapshots.flatMap(item => item.snapshot.incidents);
    const pages = currentSnapshot().config.pages;
    return context.json(
      {
        config: {
          slug: page?.slug ?? '',
          title: page?.title ?? '',
          description: page?.description ?? '',
          icon: `/api/icon${page ? `?pageId=${encodeURIComponent(page.slug)}` : ''}`,
          theme: 'system',
          published: true,
          showTags: true,
          customCSS: '',
          footerText: '',
          showPoweredBy: false,
          googleAnalyticsId: null,
          showCertificateExpiry: false,
        },
        incidents,
        maintenanceList: [],
        success: available,
        status: available ? 'ok' : 'all_failed',
        pageTabs: pages.map(item => ({
          id: item.slug,
          title: item.title,
          description: item.description,
          icon: `/api/icon?pageId=${encodeURIComponent(item.slug)}`,
          health: 'healthy',
        })),
        matrixStatus: available ? 'ok' : 'all_failed',
        ...(available
          ? {}
          : {
              failureType: 'unavailable',
              error: 'No normalized source snapshot is available yet',
            }),
        timestamp: Date.now(),
      },
      available ? 200 : 503
    );
  });

  app.get('/api/monitor', context => {
    const page = findLegacyPage(context.req.query('pageId'));
    const pageSnapshots = page ? (loadPageSnapshots?.(page) ?? []) : [];
    const available = Boolean(page && pageSnapshots.length > 0);
    setLegacyHeaders(context, available);
    const services = pageSnapshots.flatMap(item =>
      item.snapshot.services.map(service => ({ sourceId: item.snapshot.sourceId, service }))
    );
    const serviceIds = new Map(
      services.map((item, index) => [`${item.sourceId}:${item.service.id}`, index + 1])
    );
    const heartbeatList = Object.fromEntries(
      services.map(item => {
        const id = serviceIds.get(`${item.sourceId}:${item.service.id}`) as number;
        const status =
          item.service.status === 'operational'
            ? 1
            : item.service.status === 'maintenance'
              ? 3
              : item.service.status === 'unknown'
                ? 2
                : 0;
        return [
          id,
          [
            {
              status,
              time: item.service.observedAt ?? pageSnapshots[0]?.snapshot.fetchedAt,
              msg: item.service.status,
              ping: item.service.latencyMs,
            },
          ],
        ];
      })
    );
    const uptimeList = Object.fromEntries(
      services.map(item => [
        `${serviceIds.get(`${item.sourceId}:${item.service.id}`) as number}_24`,
        item.service.uptime24h ?? 0,
      ])
    );
    const monitorGroups = pageSnapshots.flatMap(item =>
      item.snapshot.groups.map(group => ({
        id: group.position + 1,
        name: group.name,
        weight: group.position,
        monitorList: group.serviceIds.flatMap(serviceId => {
          const service = item.snapshot.services.find(candidate => candidate.id === serviceId);
          if (!service) return [];
          return [
            {
              id: serviceIds.get(`${item.snapshot.sourceId}:${service.id}`) as number,
              name: service.name,
              sendUrl: 0,
              type: 'unknown',
            },
          ];
        }),
      }))
    );
    return context.json(
      {
        monitorGroups,
        data: { heartbeatList, uptimeList },
        success: available,
        status: available ? 'ok' : 'all_failed',
        ...(available
          ? {}
          : {
              failureType: 'unavailable',
              error: 'No normalized source snapshot is available yet',
            }),
        timestamp: Date.now(),
      },
      available ? 200 : 503
    );
  });

  app.get('/api/icon', async context => {
    setLegacyHeaders(context, true);
    if (!publicDirectory) {
      context.header('Cache-Control', 'no-store');
      return context.body(null, 404);
    }
    try {
      const icon = await readFile(resolve(publicDirectory, 'icon.svg'));
      if (icon.byteLength > 2 * 1024 * 1024) throw new Error('Fallback icon exceeds 2 MiB');
      context.header('Content-Type', 'image/svg+xml');
      context.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
      return context.body(icon);
    } catch {
      context.header('Cache-Control', 'no-store');
      return context.body(null, 404);
    }
  });

  app.get('/api/manage-status-page', context => {
    setLegacyHeaders(context, true);
    const page = findLegacyPage(context.req.query('pageId'));
    if (!page?.features?.editThisPage) return context.redirect('/', 307);
    const source = currentSnapshot().config.sources.find(item => item.id === page.sourceRefs[0]);
    return source
      ? context.redirect(`${source.baseUrl.replace(/\/$/u, '')}/manage-status-page`, 307)
      : context.redirect('/', 307);
  });

  app.get('/api/v1/meta', context => {
    const runtime = currentSnapshot();
    const reload = getFileReloadStatus?.();
    context.header('Cache-Control', 'no-store');
    return context.json({
      version: buildVersion,
      schemaVersion,
      release: releaseManifest
        ? {
            channel: releaseManifest.channel,
            stable: releaseManifest.stable,
            source: releaseManifest.source,
            container: releaseManifest.container,
          }
        : null,
      config: {
        mode: runtime.mode,
        revision: runtime.revision,
        contentHash: runtime.contentHash,
        loadedAt: runtime.loadedAt,
        reload: reload
          ? {
              state: reload.state,
              lastAttemptAt: reload.lastAttemptAt,
              lastSuccessAt: reload.lastSuccessAt,
              lastErrorCode: reload.lastErrorCode,
            }
          : null,
      },
      capabilities: {
        managedConfig: runtime.mode === 'managed',
        fileConfig: runtime.mode === 'file',
        legacyEnvironment: runtime.mode === 'compatibility',
        sourceAdapters: ['uptime-kuma', 'better-stack', 'uptime-robot', 'incident-io', 'llm-mieru'],
        emailSubscriptions: isEmailDeliveryEnabled(),
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

  app.get('/api/v1/public/pages/:slug/mirrored-events', context => {
    const page = findPage(context.req.param('slug'));
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    context.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    return context.json({
      data: database
        ? listMirroredEvents(database, mirroredFiltersForPage(page)).map(publicMirroredEvent)
        : [],
    });
  });

  app.get('/api/v1/public/pages/:slug/mirrored-events/:id', context => {
    const page = findPage(context.req.param('slug'));
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    const event = database
      ? getMirroredEventTimeline(database, mirroredFiltersForPage(page), context.req.param('id'))
      : null;
    if (!event) {
      return errorResponse(
        context,
        404,
        'MIRRORED_EVENT_NOT_FOUND',
        'Mirrored source event not found'
      );
    }
    context.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    return context.json({ data: publicMirroredEvent(event) });
  });

  app.get('/api/v1/public/pages/:slug/maintenance', context => {
    const page = findPage(context.req.param('slug'));
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    context.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    return context.json({ data: database ? listPublishedMaintenances(database, page.id) : [] });
  });

  app.get('/api/v1/public/pages/:slug/maintenance/:id', context => {
    const page = findPage(context.req.param('slug'));
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    const data = database
      ? getPublishedMaintenance(database, page.id, context.req.param('id'))
      : [];
    if (data.length === 0) {
      return errorResponse(
        context,
        404,
        'MAINTENANCE_NOT_FOUND',
        'Published maintenance not found'
      );
    }
    context.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    return context.json({ data });
  });

  app.get('/api/v1/public/pages/:slug/notices', context => {
    const page = findPage(context.req.param('slug'));
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    context.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    return context.json({ data: database ? listPublishedNotices(database, page.id) : [] });
  });

  app.get('/api/v1/public/pages/:slug/incidents/:id/postmortems', context => {
    const page = findPage(context.req.param('slug'));
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    context.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    return context.json({
      data: database ? listPublishedPostmortems(database, page.id, context.req.param('id')) : [],
    });
  });

  const renderFeed = (context: Context<AppEnvironment>, format: 'rss' | 'atom') => {
    const slug = context.req.param('slug');
    if (!slug) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    const page = findPage(slug);
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    const items = database ? listPublishedEvents(database, page.id) : [];
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
    if (!subscriptionNonce || !isEmailDeliveryEnabled()) {
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
    if (!database || !piiProtector || !subscriptionNonce || !isEmailDeliveryEnabled()) {
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
        data: unsubscribeEmail(
          database,
          piiProtector,
          context.req.param('token'),
          subscriberTombstones
        ),
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

  app.get('/api/v1/public/pages/:slug/metrics/catalog', context => {
    const page = findPage(context.req.param('slug'));
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    const windows = loadPageMetricWindows?.(page) ?? [];
    if (windows.length === 0) {
      context.header('Cache-Control', 'no-store');
      return errorResponse(
        context,
        404,
        'METRIC_EXTENSION_UNAVAILABLE',
        'No native metric extension is available for this page'
      );
    }
    const grouped = new Map<string, MetricWindowState[]>();
    for (const window of windows) {
      const key = `${window.sourceId}\u0000${window.pageId}`;
      grouped.set(key, [...(grouped.get(key) ?? []), window]);
    }
    const stale = windows.every(window => window.stale);
    context.header(
      'Cache-Control',
      stale
        ? 'public, max-age=0, must-revalidate'
        : 'public, max-age=300, stale-while-revalidate=600'
    );
    return context.json({
      data: [...grouped.values()].map(sourceWindows => {
        const latest = sourceWindows.reduce((candidate, window) =>
          Date.parse(window.fetchedAt) > Date.parse(candidate.fetchedAt) ? window : candidate
        );
        return {
          sourceId: latest.sourceId,
          pageId: latest.pageId,
          metrics: latest.extension.catalog,
          windows: sourceWindows.map(window => ({
            window: window.window,
            fetchedAt: window.fetchedAt,
            staleAfter: window.staleAfter,
            stale: window.stale,
          })),
        };
      }),
    });
  });

  app.get('/api/v1/public/pages/:slug/metrics/query', context => {
    const page = findPage(context.req.param('slug'));
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    const rawQuery = context.req.queries();
    const allowedParameters = new Set(['metric', 'source', 'window']);
    if (
      Object.entries(rawQuery).some(
        ([key, values]) => !allowedParameters.has(key) || values.length !== 1
      )
    ) {
      return errorResponse(context, 400, 'INVALID_METRIC_QUERY', 'Metric query is invalid');
    }
    const query = publicMetricQuerySchema.safeParse({
      metric: context.req.query('metric'),
      source: context.req.query('source'),
      window: context.req.query('window'),
    });
    if (!query.success) {
      return errorResponse(context, 400, 'INVALID_METRIC_QUERY', 'Metric query is invalid');
    }
    const { metric: metricId, source: sourceId, window } = query.data;
    const windows = (loadPageMetricWindows?.(page) ?? []).filter(
      candidate => candidate.window === window && (!sourceId || candidate.sourceId === sourceId)
    );
    const candidates = windows.flatMap(candidate =>
      candidate.extension.series
        .filter(series => series.metricId === metricId && series.window === window)
        .map(series => ({ window: candidate, series }))
    );
    if (candidates.length === 0) {
      context.header('Cache-Control', 'no-store');
      return errorResponse(
        context,
        404,
        'METRIC_SERIES_UNAVAILABLE',
        'The requested metric series is not available in the local cache'
      );
    }
    const stale = candidates.some(candidate => candidate.window.stale);
    context.header(
      'Cache-Control',
      stale ? 'public, max-age=0, must-revalidate' : 'public, max-age=15, stale-while-revalidate=30'
    );
    return context.json({
      data: candidates.map(({ window: cachedWindow, series }) => ({
        sourceId: cachedWindow.sourceId,
        pageId: cachedWindow.pageId,
        metricId: series.metricId,
        unit: series.unit,
        window: series.window,
        generatedAt: series.generatedAt,
        fetchedAt: cachedWindow.fetchedAt,
        staleAfter: cachedWindow.staleAfter,
        stale: cachedWindow.stale,
        points: series.points,
      })),
    });
  });

  app.get('/api/v1/public/pages/:slug/methodology', context => {
    const page = findPage(context.req.param('slug'));
    if (!page) return errorResponse(context, 404, 'PAGE_NOT_FOUND', 'Status page not found');
    const methodologies = loadPageMethodologies?.(page) ?? [];
    if (methodologies.length === 0) {
      context.header('Cache-Control', 'no-store');
      return errorResponse(
        context,
        404,
        'METHODOLOGY_UNAVAILABLE',
        'No methodology snapshot is available for this page'
      );
    }
    const stale = methodologies.every(methodology => methodology.stale);
    context.header(
      'Cache-Control',
      stale
        ? 'public, max-age=0, must-revalidate'
        : 'public, max-age=300, stale-while-revalidate=600'
    );
    return context.json({
      data: methodologies.map(methodology => ({
        sourceId: methodology.sourceId,
        pageId: methodology.pageId,
        fetchedAt: methodology.fetchedAt,
        staleAfter: methodology.staleAfter,
        stale: methodology.stale,
        snapshot: methodology.snapshot,
      })),
      meta: { status: stale ? 'stale' : 'ok' },
    });
  });

  registerAdminRoutes(app, {
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
    backupService,
    retentionService,
    subscriberTombstones,
  });

  app.get('/:pageId', async (context, next) => {
    const page = findPage(context.req.param('pageId'));
    if (!page) return next();
    return canonicalRedirect(context, `/status/${encodeURIComponent(page.slug)}/`);
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

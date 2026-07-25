import type { Page, Route } from '@playwright/test';

export interface PublicApiOptions {
  emailSubscriptions?: boolean;
  partialCoverage?: boolean;
  staleSource?: boolean;
}

const publishedAt = {
  incidentStart: '2026-07-24T09:05:00.000Z',
  maintenance: '2026-07-24T09:35:00.000Z',
  incidentResolved: '2026-07-24T10:05:00.000Z',
  notice: '2026-07-24T10:35:00.000Z',
  postmortem: '2026-07-24T11:05:00.000Z',
} as const;

const incidentStart = {
  publicationId: 'publication-incident-start',
  eventId: 'incident-api-latency',
  eventSequence: 1,
  pageId: 'page-main',
  title: 'API latency under investigation',
  body: 'Requests in the west region are taking longer than expected.',
  affectedComponentIds: ['api-gateway'],
  occurredAt: '2026-07-24T09:00:00.000Z',
  recordedAt: '2026-07-24T09:02:00.000Z',
  publishedAt: publishedAt.incidentStart,
  type: 'incident',
  state: 'investigating',
};

const incidentResolved = {
  ...incidentStart,
  publicationId: 'publication-incident-resolved',
  eventSequence: 2,
  title: 'API latency recovered',
  body: 'Traffic has returned to the normal latency envelope.',
  occurredAt: '2026-07-24T10:00:00.000Z',
  recordedAt: '2026-07-24T10:02:00.000Z',
  publishedAt: publishedAt.incidentResolved,
  state: 'resolved',
};

const maintenance = {
  publicationId: 'publication-maintenance',
  eventId: 'maintenance-database',
  eventSequence: 1,
  pageId: 'page-main',
  title: 'Database connection maintenance',
  body: 'Connections may be recycled during this planned window.',
  affectedComponentIds: ['api-gateway'],
  occurredAt: '2026-07-24T09:30:00.000Z',
  recordedAt: '2026-07-24T09:32:00.000Z',
  publishedAt: publishedAt.maintenance,
  type: 'maintenance',
  state: 'scheduled',
  scheduledStartAt: '2026-07-26T01:00:00.000Z',
  scheduledEndAt: '2026-07-26T02:00:00.000Z',
};

const notice = {
  publicationId: 'publication-notice',
  eventId: 'notice-routing',
  eventSequence: 1,
  pageId: 'page-main',
  title: 'Regional routing advisory',
  body: 'Some networks may observe a different ingress region. Service health is unchanged.',
  affectedComponentIds: [],
  occurredAt: '2026-07-24T10:30:00.000Z',
  recordedAt: '2026-07-24T10:32:00.000Z',
  publishedAt: publishedAt.notice,
  type: 'notice',
  state: 'published',
  kind: 'information',
  startsAt: null,
  endsAt: null,
};

const postmortem = {
  publicationId: 'publication-postmortem',
  eventId: 'postmortem-api-latency',
  eventSequence: 3,
  pageId: 'page-main',
  title: 'API latency review',
  body: 'A route preference change increased cross-region traffic for sixty minutes.',
  affectedComponentIds: ['api-gateway'],
  occurredAt: '2026-07-24T11:00:00.000Z',
  recordedAt: '2026-07-24T11:02:00.000Z',
  publishedAt: publishedAt.postmortem,
  type: 'postmortem',
  state: 'published',
  incidentId: 'incident-api-latency',
};

const publications = [notice, incidentResolved, maintenance];

const fulfillJson = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

export const installPublicApi = async (page: Page, options: PublicApiOptions = {}) => {
  const emailSubscriptions = options.emailSubscriptions ?? false;
  const staleSource = options.staleSource ?? false;
  const snapshot = {
    data: [
      {
        snapshot: {
          sourceId: 'uptime-primary',
          pageId: 'upstream-main',
          title: 'Primary Uptime source',
          description: 'Synthetic API and edge checks',
          status: 'operational',
          fetchedAt: '2026-07-25T01:00:00.000Z',
          extensions: {},
          capabilities: {
            currentStatus: true,
            heartbeatSeries: true,
            latencySeries: false,
            uptimeWindows: ['24h'],
            incidents: 'history',
            maintenance: true,
            groups: true,
            tags: true,
            nativeMetrics: false,
            historicalDays: 90,
          },
          groups: [
            {
              id: 'core',
              name: 'Core services',
              position: 0,
              serviceIds: ['api-gateway'],
            },
          ],
          services: [
            {
              id: 'api-gateway',
              sourceId: 'uptime-primary',
              upstreamId: 'monitor-7',
              name: 'API Gateway',
              groupId: 'core',
              tags: [{ name: 'region', value: 'global', color: '#047857' }],
              status: 'operational',
              rawStatus: 1,
              latencyMs: 42,
              observedAt: '2026-07-25T00:59:30.000Z',
              uptime24h: 99.98,
            },
          ],
          incidents: [],
        },
        health: {
          state: staleSource ? 'stale' : 'healthy',
          stale: staleSource,
          staleAfter: '2026-07-25T01:02:00.000Z',
          lastSuccessAt: '2026-07-25T01:00:00.000Z',
          errorCode: staleSource ? 'source_stale' : null,
        },
      },
    ],
    meta: { status: options.partialCoverage ? 'partial' : 'ok' },
  };

  await page.route('**/api/v1/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === '/api/v1/meta') {
      return fulfillJson(route, {
        version: '2.0.0-e2e',
        schemaVersion: 13,
        config: {
          mode: 'managed',
          revision: 7,
          contentHash: 'reference-public-snapshot-20260725',
          loadedAt: '2026-07-25T01:00:00.000Z',
          reload: null,
        },
        capabilities: {
          managedConfig: true,
          fileConfig: true,
          legacyEnvironment: true,
          sourceAdapters: ['uptime-kuma'],
          emailSubscriptions,
        },
      });
    }
    if (path === '/api/v1/public/pages') {
      return fulfillJson(route, {
        data: [
          {
            id: 'page-main',
            slug: 'main',
            title: 'Core services',
            sourceRefs: ['uptime-primary'],
          },
        ],
      });
    }
    if (path === '/api/v1/public/pages/main/snapshot') {
      return fulfillJson(route, snapshot);
    }
    if (path === '/api/v1/public/pages/main/events') {
      return fulfillJson(route, { data: publications });
    }
    if (path === '/api/v1/public/pages/main/notices') {
      return fulfillJson(route, { data: [notice] });
    }
    if (path === '/api/v1/public/pages/main/mirrored-events') {
      return fulfillJson(route, {
        data: [
          {
            id: 'mirrored-upstream-maintenance',
            origin: 'mirrored',
            notificationEligible: false,
            type: 'maintenance',
            presence: 'absent',
            version: 2,
            title: 'Upstream network maintenance',
            content: 'The upstream provider no longer advertises this maintenance window.',
            severity: 'info',
            startedAt: '2026-07-23T01:00:00.000Z',
            sourceUpdatedAt: '2026-07-23T02:00:00.000Z',
            rawStatus: 'completed',
            firstSeenAt: '2026-07-23T00:50:00.000Z',
            lastSeenAt: '2026-07-23T02:05:00.000Z',
            absentAt: '2026-07-23T02:10:00.000Z',
            updatedAt: '2026-07-23T02:10:00.000Z',
            source: {
              id: 'uptime-primary',
              pageId: 'upstream-main',
              eventId: 'maintenance-upstream',
              url: null,
            },
          },
        ],
      });
    }
    if (path === '/api/v1/public/pages/main/incidents/incident-api-latency') {
      return fulfillJson(route, { data: [incidentStart, incidentResolved] });
    }
    if (path === '/api/v1/public/pages/main/incidents/incident-api-latency/postmortems') {
      return fulfillJson(route, { data: [postmortem] });
    }
    if (path === '/api/v1/public/pages/main/maintenance/maintenance-database') {
      return fulfillJson(route, { data: [maintenance] });
    }
    if (
      path === '/api/v1/public/pages/main/subscriptions/email/nonce' &&
      request.method() === 'GET'
    ) {
      return fulfillJson(route, {
        data: { nonce: 'e2e-reference-nonce', expiresAt: '2026-07-25T01:05:00.000Z' },
      });
    }
    if (path === '/api/v1/public/pages/main/subscriptions/email' && request.method() === 'POST') {
      return fulfillJson(route, {
        data: {
          accepted: true,
          message: 'If the address is eligible, a confirmation message will be sent.',
        },
      });
    }

    return fulfillJson(
      route,
      { code: 'E2E_ROUTE_MISSING', message: `No reference response for ${path}` },
      404
    );
  });
};

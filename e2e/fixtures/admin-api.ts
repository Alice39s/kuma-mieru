import type { Page, Route } from '@playwright/test';

type AdminRole = 'owner' | 'publisher' | 'editor' | 'viewer';

interface AdminSource {
  id: string;
  kind: 'uptime-kuma' | 'better-stack' | 'incident-io' | 'uptime-robot' | 'llm-mieru';
  baseUrl: string;
  pageIds: string[];
  authenticated: boolean;
}

interface AdminPage {
  id: string;
  slug: string;
  title: string;
  sourceRefs: string[];
}

interface AdminRevision {
  revision: number;
  contentHash: string;
  parentRevision: number | null;
  actor: string;
  createdAt: string;
}

interface AdminIncident {
  id: string;
  type: 'incident';
  pageId: string;
  title: string;
  state: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  latestEntry: {
    sequence: number;
    state: 'investigating' | 'identified' | 'monitoring' | 'resolved';
    title: string;
    body: string;
    affectedComponentIds: string[];
    occurredAt: string;
    recordedAt: string;
    actorId: string;
  };
}

type SubscriberState =
  | 'pending_confirmation'
  | 'active'
  | 'unsubscribed'
  | 'suppressed'
  | 'expired';

interface AdminSubscriber {
  id: string;
  pageId: string;
  incidentId: string | null;
  scope: string;
  componentIds: string[];
  recipient: string;
  state: SubscriberState;
  createdAt: string;
  confirmedAt: string | null;
  updatedAt: string;
}

type DeliveryState = 'queued' | 'processing' | 'sent' | 'failed' | 'dead_letter';

interface AdminDelivery {
  id: string;
  publicationId: string | null;
  subscriptionId: string;
  pageId: string;
  recipient: string;
  channel: string;
  kind: string;
  state: DeliveryState;
  subscriberState: SubscriberState;
  attempts: number;
  nextAttemptAt: string;
  lastErrorCode: string | null;
  createdAt: string;
  sentAt: string | null;
}

interface SmtpCandidate {
  enabled: true;
  host: string;
  port: number;
  tls: 'implicit' | 'starttls';
  from: { address: string; name?: string };
  replyTo?: string;
  credentialSetId?: string;
  usernameRef?: string;
  passwordRef?: string;
}

interface SmtpStatus {
  runtime: {
    state: 'disabled' | 'running' | 'failed';
    configured: boolean;
    appliedAt: string;
    lastErrorCode: string | null;
  };
  configuration:
    | { enabled: false }
    | {
        enabled: true;
        host: string;
        port: number;
        tls: 'implicit' | 'starttls';
        from: { address: string; name?: string };
        replyTo?: string | null;
        authenticated: boolean;
      };
}

export interface AdminApiOptions {
  empty?: boolean;
  role?: AdminRole;
  setupRequired?: boolean;
  withDelivery?: boolean;
  withIncident?: boolean;
}

export interface AdminApiState {
  authenticated: boolean;
  deliveries: AdminDelivery[];
  incidents: AdminIncident[];
  mutationHeaders: Array<{ csrf: string | null; origin: string | null }>;
  ownerSetup: { email: string; name: string; password: string; token: string } | null;
  pages: AdminPage[];
  publications: Array<{
    eventId: string;
    expectedVersion: number;
    notifySubscribers: boolean;
    reviewNonce: string;
  }>;
  revision: number;
  role: AdminRole;
  sentTestRecipients: string[];
  smtp: SmtpStatus;
  sources: AdminSource[];
  stagedCredentials: boolean;
  subscribers: AdminSubscriber[];
}

const fulfillJson = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

const parseBody = <T>(route: Route) => JSON.parse(route.request().postData() ?? '{}') as T;

const referenceSource: AdminSource = {
  id: 'uptime-primary',
  kind: 'uptime-kuma',
  baseUrl: 'https://status.example.com',
  pageIds: ['main'],
  authenticated: false,
};

const referencePage: AdminPage = {
  id: 'page-main',
  slug: 'main',
  title: 'Core services',
  sourceRefs: ['uptime-primary'],
};

const referenceIncident: AdminIncident = {
  id: 'incident-api-latency',
  type: 'incident',
  pageId: 'page-main',
  title: 'API latency elevated',
  state: 'investigating',
  version: 1,
  createdBy: 'editor-e2e-reference',
  createdAt: '2026-07-25T01:30:00.000Z',
  updatedAt: '2026-07-25T01:30:00.000Z',
  latestEntry: {
    sequence: 1,
    state: 'investigating',
    title: 'API latency elevated',
    body: 'We are investigating elevated latency in the inference API.',
    affectedComponentIds: ['api', 'inference'],
    occurredAt: '2026-07-25T01:30:00.000Z',
    recordedAt: '2026-07-25T01:30:00.000Z',
    actorId: 'editor-e2e-reference',
  },
};

const referenceSubscriber: AdminSubscriber = {
  id: 'subscriber-reference',
  pageId: 'page-main',
  incidentId: null,
  scope: 'page',
  componentIds: [],
  recipient: 'sha256:4d2f…8a90',
  state: 'active',
  createdAt: '2026-07-24T01:00:00.000Z',
  confirmedAt: '2026-07-24T01:05:00.000Z',
  updatedAt: '2026-07-24T01:05:00.000Z',
};

const referenceDelivery: AdminDelivery = {
  id: 'delivery-reference',
  publicationId: 'publication-reference',
  subscriptionId: 'subscriber-reference',
  pageId: 'page-main',
  recipient: 'sha256:4d2f…8a90',
  channel: 'email',
  kind: 'event_publication',
  state: 'failed',
  subscriberState: 'active',
  attempts: 3,
  nextAttemptAt: '2026-07-25T02:10:00.000Z',
  lastErrorCode: 'smtp_transient',
  createdAt: '2026-07-25T02:00:00.000Z',
  sentAt: null,
};

const disabledSmtp = (): SmtpStatus => ({
  runtime: {
    state: 'disabled',
    configured: false,
    appliedAt: '2026-07-25T01:00:00.000Z',
    lastErrorCode: null,
  },
  configuration: { enabled: false },
});

const recordMutationBoundary = (route: Route, state: AdminApiState) => {
  const headers = route.request().headers();
  state.mutationHeaders.push({
    csrf: headers['x-kuma-csrf'] ?? null,
    origin: headers.origin ?? null,
  });
};

export const installAdminApi = async (
  page: Page,
  options: AdminApiOptions = {}
): Promise<AdminApiState> => {
  let setupRequired = options.setupRequired ?? false;
  const state: AdminApiState = {
    authenticated: !setupRequired,
    deliveries: options.withDelivery ? [{ ...referenceDelivery }] : [],
    incidents: options.withIncident ? [{ ...referenceIncident }] : [],
    mutationHeaders: [],
    ownerSetup: null,
    pages: options.empty ? [] : [{ ...referencePage }],
    publications: [],
    revision: options.empty ? 1 : 7,
    role: options.role ?? 'owner',
    sentTestRecipients: [],
    smtp: disabledSmtp(),
    sources: options.empty ? [] : [{ ...referenceSource }],
    stagedCredentials: false,
    subscribers: options.withDelivery ? [{ ...referenceSubscriber }] : [],
  };
  const revisions: AdminRevision[] = options.empty
    ? [
        {
          revision: 1,
          contentHash: 'reference-bootstrap-configuration',
          parentRevision: null,
          actor: 'setup',
          createdAt: '2026-07-25T01:00:00.000Z',
        },
      ]
    : [
        {
          revision: 7,
          contentHash: 'reference-current-configuration',
          parentRevision: 6,
          actor: 'owner-e2e-reference',
          createdAt: '2026-07-25T01:00:00.000Z',
        },
        {
          revision: 6,
          contentHash: 'reference-previous-configuration',
          parentRevision: 5,
          actor: 'owner-e2e-reference',
          createdAt: '2026-07-24T01:00:00.000Z',
        },
      ];

  const commitRevision = (actor: string) => {
    const parentRevision = state.revision;
    state.revision += 1;
    revisions.unshift({
      revision: state.revision,
      contentHash: `reference-revision-${state.revision}`,
      parentRevision,
      actor,
      createdAt: '2026-07-25T02:00:00.000Z',
    });
  };

  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (pathname === '/api/v1/setup/status' && method === 'GET') {
      return fulfillJson(route, {
        data: {
          required: setupRequired,
          available: setupRequired,
          expiresAt: setupRequired ? '2026-07-25T02:30:00.000Z' : null,
        },
      });
    }

    if (pathname === '/api/v1/setup/owner' && method === 'POST') {
      const input = parseBody<{ email: string; name: string; password: string; token: string }>(
        route
      );
      state.ownerSetup = input;
      setupRequired = false;
      return fulfillJson(route, { data: { userId: 'owner-e2e-reference', role: 'owner' } });
    }

    if (pathname === '/api/auth/sign-in/email' && method === 'POST') {
      state.authenticated = true;
      return fulfillJson(route, { data: { accepted: true } });
    }

    if (pathname === '/api/auth/sign-out' && method === 'POST') {
      state.authenticated = false;
      return fulfillJson(route, { data: { accepted: true } });
    }

    if (pathname === '/api/v1/admin/session' && method === 'GET') {
      if (!state.authenticated) {
        return fulfillJson(
          route,
          { error: { code: 'UNAUTHORIZED', message: 'Sign in is required.' } },
          401
        );
      }
      return fulfillJson(route, {
        data: {
          userId: `${state.role}-e2e-reference`,
          role: state.role,
          csrfToken: 'e2e-csrf-token',
        },
      });
    }

    if (pathname === '/api/v1/meta' && method === 'GET') {
      return fulfillJson(route, {
        version: '2.0.0-e2e',
        schemaVersion: 13,
        config: {
          mode: 'managed',
          revision: state.revision,
          contentHash: `reference-revision-${state.revision}`,
          loadedAt: '2026-07-25T02:00:00.000Z',
          reload: null,
          compatibility: null,
        },
      });
    }

    if (pathname === '/api/v1/admin/config/status' && method === 'GET') {
      return fulfillJson(route, {
        data: {
          mode: 'managed',
          revision: state.revision,
          contentHash: `reference-revision-${state.revision}`,
          loadedAt: '2026-07-25T02:00:00.000Z',
          reload: null,
          compatibility: null,
        },
      });
    }

    if (pathname === '/api/v1/admin/sources' && method === 'GET') {
      return fulfillJson(route, { data: state.sources });
    }

    if (pathname === '/api/v1/admin/pages' && method === 'GET') {
      return fulfillJson(route, { data: state.pages });
    }

    if (pathname === '/api/v1/admin/config/revisions' && method === 'GET') {
      return fulfillJson(route, { data: revisions });
    }

    if (pathname === '/api/v1/admin/events' && method === 'GET') {
      return fulfillJson(route, { data: state.incidents });
    }

    if (
      [
        '/api/v1/admin/mirrored-events',
        '/api/v1/admin/maintenances',
        '/api/v1/admin/notices',
        '/api/v1/admin/postmortems',
      ].includes(pathname) &&
      method === 'GET'
    ) {
      return fulfillJson(route, { data: [] });
    }

    if (pathname === '/api/v1/admin/automation/suggestions' && method === 'GET') {
      return fulfillJson(route, { data: [] });
    }

    if (pathname === '/api/v1/admin/subscribers' && method === 'GET') {
      return fulfillJson(route, { data: state.subscribers });
    }

    if (pathname === '/api/v1/admin/deliveries' && method === 'GET') {
      return fulfillJson(route, { data: state.deliveries });
    }

    if (pathname === '/api/v1/admin/delivery/smtp' && method === 'GET') {
      return fulfillJson(route, { data: state.smtp });
    }

    if (pathname === '/api/v1/admin/incidents' && method === 'POST') {
      recordMutationBoundary(route, state);
      const input = parseBody<{
        pageId: string;
        title: string;
        body: string;
        affectedComponentIds: string[];
      }>(route);
      const incident: AdminIncident = {
        ...referenceIncident,
        id: `incident-${state.incidents.length + 1}`,
        pageId: input.pageId,
        title: input.title,
        createdBy: `${state.role}-e2e-reference`,
        latestEntry: {
          ...referenceIncident.latestEntry,
          title: input.title,
          body: input.body,
          affectedComponentIds: input.affectedComponentIds,
          actorId: `${state.role}-e2e-reference`,
        },
      };
      state.incidents.push(incident);
      return fulfillJson(route, { data: incident }, 201);
    }

    const incidentReview = pathname.match(/^\/api\/v1\/admin\/incidents\/([^/]+)\/review$/);
    if (incidentReview && method === 'POST') {
      recordMutationBoundary(route, state);
      const incident = state.incidents.find(item => item.id === incidentReview[1]);
      const input = parseBody<{ expectedVersion: number; notifySubscribers: boolean }>(route);
      return fulfillJson(route, {
        data: {
          incident,
          notifySubscribers: input.notifySubscribers,
          estimatedRecipients: state.subscribers.filter(item => item.state === 'active').length,
          reviewNonce: `review-${incidentReview[1]}-${input.expectedVersion}`,
          expiresAt: '2026-07-25T02:10:00.000Z',
        },
      });
    }

    const incidentPublish = pathname.match(/^\/api\/v1\/admin\/incidents\/([^/]+)\/publish$/);
    if (incidentPublish && method === 'POST') {
      recordMutationBoundary(route, state);
      const input = parseBody<{
        expectedVersion: number;
        notifySubscribers: boolean;
        reviewNonce: string;
      }>(route);
      state.publications.push({ eventId: incidentPublish[1] ?? '', ...input });
      return fulfillJson(
        route,
        {
          data: {
            publicationId: `publication-${state.publications.length}`,
            publishedAt: '2026-07-25T02:06:00.000Z',
          },
        },
        201
      );
    }

    if (pathname === '/api/v1/admin/secrets/smtp-credentials' && method === 'POST') {
      recordMutationBoundary(route, state);
      state.stagedCredentials = true;
      return fulfillJson(route, {
        data: {
          credentialSetId: 'smtp-credential-set-reference',
          usernameRef: 'secret://smtp/username',
          passwordRef: 'secret://smtp/password',
        },
      });
    }

    if (pathname === '/api/v1/admin/delivery/smtp/test' && method === 'POST') {
      recordMutationBoundary(route, state);
      return fulfillJson(route, {
        data: {
          token: 'smtp-test-token-reference',
          expiresAt: '2026-07-25T02:10:00.000Z',
        },
      });
    }

    if (pathname === '/api/v1/admin/delivery/smtp' && method === 'PUT') {
      recordMutationBoundary(route, state);
      const input = parseBody<{ smtp: SmtpCandidate | { enabled: false } }>(route);
      if (input.smtp.enabled) {
        state.smtp = {
          runtime: {
            state: 'running',
            configured: true,
            appliedAt: '2026-07-25T02:05:00.000Z',
            lastErrorCode: null,
          },
          configuration: {
            enabled: true,
            host: input.smtp.host,
            port: input.smtp.port,
            tls: input.smtp.tls,
            from: input.smtp.from,
            replyTo: input.smtp.replyTo ?? null,
            authenticated: Boolean(input.smtp.credentialSetId),
          },
        };
      } else {
        state.smtp = disabledSmtp();
      }
      commitRevision(`${state.role}-e2e-reference`);
      return fulfillJson(route, {
        data: { revision: state.revision, applyStatus: 'applied' },
      });
    }

    if (pathname === '/api/v1/admin/delivery/smtp/send-test' && method === 'POST') {
      recordMutationBoundary(route, state);
      const input = parseBody<{ recipient: string }>(route);
      state.sentTestRecipients.push(input.recipient);
      return fulfillJson(route, { data: { messageId: 'smtp-message-reference' } });
    }

    const deliveryRetry = pathname.match(/^\/api\/v1\/admin\/deliveries\/([^/]+)\/retry$/);
    if (deliveryRetry && method === 'POST') {
      recordMutationBoundary(route, state);
      const delivery = state.deliveries.find(item => item.id === deliveryRetry[1]);
      if (!delivery) {
        return fulfillJson(route, { error: { code: 'NOT_FOUND' } }, 404);
      }
      delivery.state = 'queued';
      delivery.attempts += 1;
      delivery.lastErrorCode = null;
      return fulfillJson(route, { data: delivery });
    }

    const subscriberSuppress = pathname.match(/^\/api\/v1\/admin\/subscribers\/([^/]+)\/suppress$/);
    if (subscriberSuppress && method === 'POST') {
      recordMutationBoundary(route, state);
      const subscriber = state.subscribers.find(item => item.id === subscriberSuppress[1]);
      if (!subscriber) {
        return fulfillJson(route, { error: { code: 'NOT_FOUND' } }, 404);
      }
      subscriber.state = 'suppressed';
      subscriber.updatedAt = '2026-07-25T02:07:00.000Z';
      state.deliveries
        .filter(item => item.subscriptionId === subscriber.id)
        .forEach(delivery => {
          delivery.subscriberState = 'suppressed';
        });
      return fulfillJson(route, { data: subscriber });
    }

    if (pathname === '/api/v1/admin/sources/test' && method === 'POST') {
      recordMutationBoundary(route, state);
      const { source } = parseBody<{ source: AdminSource }>(route);
      return fulfillJson(route, {
        data: {
          token: 'e2e-source-test-token',
          expiresAt: '2026-07-25T02:05:00.000Z',
          pages: source.pageIds.map(pageId => ({
            pageId,
            title: pageId === 'main' ? 'Core services' : 'Default status page',
            status: 'operational',
            serviceCount: 1,
          })),
        },
      });
    }

    if (pathname === '/api/v1/admin/sources' && method === 'POST') {
      recordMutationBoundary(route, state);
      const { source } = parseBody<{
        source: Omit<AdminSource, 'authenticated'> & { secretRef?: string };
      }>(route);
      state.sources.push({
        id: source.id,
        kind: source.kind,
        baseUrl: source.baseUrl,
        pageIds: source.pageIds,
        authenticated: Boolean(source.secretRef),
      });
      commitRevision(`${state.role}-e2e-reference`);
      return fulfillJson(route, {
        data: { revision: state.revision, applyStatus: 'applied' },
      });
    }

    if (pathname === '/api/v1/admin/pages' && method === 'POST') {
      recordMutationBoundary(route, state);
      const { page: newPage } = parseBody<{ page: AdminPage }>(route);
      state.pages.push(newPage);
      commitRevision(`${state.role}-e2e-reference`);
      return fulfillJson(route, {
        data: { revision: state.revision, applyStatus: 'applied' },
      });
    }

    return fulfillJson(
      route,
      {
        error: {
          code: 'E2E_ROUTE_MISSING',
          message: `No admin reference response for ${method} ${pathname}`,
        },
      },
      404
    );
  });

  return state;
};

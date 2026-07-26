import type { Page, Route } from '@playwright/test';

type AdminRole = 'owner' | 'publisher' | 'editor' | 'viewer';
type EventTemplateType = 'incident' | 'maintenance' | 'notice' | 'postmortem';
type EventTemplateState = 'active' | 'archived';

interface AppliedEventTemplate {
  id: string;
  version: number;
  defaultNotifySubscribers: boolean;
}

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
  template: AppliedEventTemplate | null;
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

interface AdminEventTemplate {
  id: string;
  name: string;
  eventType: EventTemplateType;
  state: EventTemplateState;
  version: number;
  title: string;
  body: string;
  affectedComponentIds: string[];
  defaultNotifySubscribers: boolean;
  noticeKind: 'information' | 'warning' | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  latestEntry: {
    sequence: number;
    state: EventTemplateState;
    name: string;
    title: string;
    body: string;
    affectedComponentIds: string[];
    defaultNotifySubscribers: boolean;
    noticeKind: 'information' | 'warning' | null;
    recordedAt: string;
    actorId: string;
  };
}

type RecurringMaintenancePlanState = 'active' | 'paused' | 'archived';
interface AdminRecurringMaintenancePlan {
  id: string;
  pageId: string;
  name: string;
  state: RecurringMaintenancePlanState;
  version: number;
  title: string;
  body: string;
  affectedComponentIds: string[];
  schedule: {
    timeBasis: 'utc';
    frequency: 'daily' | 'weekly';
    interval: number;
    weekdays: number[];
    anchorStartAt: string;
    durationMinutes: number;
    endsAt: string | null;
  };
  nextOccurrenceAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
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

interface AdminUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: AdminRole;
  createdAt: string;
  updatedAt: string;
  activeSessionCount: number;
  passkeyCount: number;
}

interface AdminOidcProvider {
  enabled: boolean;
  configured: boolean;
  displayName: string | null;
  discoveryUrl: string | null;
  issuer: string | null;
  clientId: string | null;
  clientSecretConfigured: boolean;
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post' | null;
  version: number;
}

interface AdminOidcMapping {
  subject: string;
  userId: string;
  name: string;
  email: string;
  role: AdminRole;
  createdAt: string;
}

export interface AdminApiOptions {
  empty?: boolean;
  role?: AdminRole;
  setupRequired?: boolean;
  withConfigFile?: boolean;
  withDelivery?: boolean;
  withIncident?: boolean;
}

export interface AdminApiState {
  authenticated: boolean;
  configMode: 'managed' | 'file';
  configTransitionApplies: Array<{
    schemaVersion: '1.0';
    from: 'managed';
    to: 'file';
    expectedActiveRevision: number;
    source: { kind: 'file'; path: string; sha256: string };
    dryRun: false;
    previewToken: string;
  }>;
  deliveries: AdminDelivery[];
  eventTemplates: AdminEventTemplate[];
  incidents: AdminIncident[];
  mutationHeaders: Array<{ csrf: string | null; origin: string | null }>;
  oidcMappings: AdminOidcMapping[];
  oidcProvider: AdminOidcProvider;
  ownerSetup: { email: string; name: string; password: string; token: string } | null;
  pages: AdminPage[];
  publications: Array<{
    eventId: string;
    expectedVersion: number;
    notifySubscribers: boolean;
    reviewNonce: string;
  }>;
  revision: number;
  recurringMaintenancePlans: AdminRecurringMaintenancePlan[];
  role: AdminRole;
  sentTestRecipients: string[];
  smtp: SmtpStatus;
  sources: AdminSource[];
  stagedCredentials: boolean;
  subscribers: AdminSubscriber[];
  users: AdminUser[];
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
  template: null,
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

const referenceEventTemplate: AdminEventTemplate = {
  id: 'template-api-degradation',
  name: 'API degradation',
  eventType: 'incident',
  state: 'active',
  version: 1,
  title: 'API latency elevated',
  body: 'We are investigating elevated latency in the inference API.',
  affectedComponentIds: ['api', 'inference'],
  defaultNotifySubscribers: true,
  noticeKind: null,
  createdBy: 'owner-e2e-reference',
  createdAt: '2026-07-25T01:20:00.000Z',
  updatedAt: '2026-07-25T01:20:00.000Z',
  latestEntry: {
    sequence: 1,
    state: 'active',
    name: 'API degradation',
    title: 'API latency elevated',
    body: 'We are investigating elevated latency in the inference API.',
    affectedComponentIds: ['api', 'inference'],
    defaultNotifySubscribers: true,
    noticeKind: null,
    recordedAt: '2026-07-25T01:20:00.000Z',
    actorId: 'owner-e2e-reference',
  },
};

const referenceRecurringMaintenancePlan: AdminRecurringMaintenancePlan = {
  id: 'recurring-database-window',
  pageId: 'page-main',
  name: 'Weekly database window',
  state: 'active',
  version: 1,
  title: 'Routine database maintenance',
  body: 'We will apply routine database updates.',
  affectedComponentIds: ['database'],
  schedule: {
    timeBasis: 'utc',
    frequency: 'weekly',
    interval: 1,
    weekdays: [1],
    anchorStartAt: '2026-07-27T01:00:00.000Z',
    durationMinutes: 60,
    endsAt: null,
  },
  nextOccurrenceAt: '2026-08-03T01:00:00.000Z',
  createdBy: 'owner-e2e-reference',
  createdAt: '2026-07-25T01:25:00.000Z',
  updatedAt: '2026-07-25T01:25:00.000Z',
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
    configMode: 'managed',
    configTransitionApplies: [],
    deliveries: options.withDelivery ? [{ ...referenceDelivery }] : [],
    eventTemplates: options.empty ? [] : [{ ...referenceEventTemplate }],
    incidents: options.withIncident ? [{ ...referenceIncident }] : [],
    mutationHeaders: [],
    oidcMappings: [],
    oidcProvider: {
      enabled: false,
      configured: false,
      displayName: null,
      discoveryUrl: null,
      issuer: null,
      clientId: null,
      clientSecretConfigured: false,
      tokenEndpointAuthMethod: null,
      version: 0,
    },
    ownerSetup: null,
    pages: options.empty ? [] : [{ ...referencePage }],
    publications: [],
    revision: options.empty ? 1 : 7,
    recurringMaintenancePlans: options.empty ? [] : [{ ...referenceRecurringMaintenancePlan }],
    role: options.role ?? 'owner',
    sentTestRecipients: [],
    smtp: disabledSmtp(),
    sources: options.empty ? [] : [{ ...referenceSource }],
    stagedCredentials: false,
    subscribers: options.withDelivery ? [{ ...referenceSubscriber }] : [],
    users: [
      {
        id: 'owner-e2e-reference',
        name: 'Reference Owner',
        email: 'owner@example.com',
        emailVerified: true,
        role: 'owner',
        createdAt: '2026-07-25T01:00:00.000Z',
        updatedAt: '2026-07-25T01:00:00.000Z',
        activeSessionCount: 1,
        passkeyCount: 1,
      },
      {
        id: 'viewer-e2e-reference',
        name: 'OIDC Viewer',
        email: 'viewer@example.com',
        emailVerified: true,
        role: 'viewer',
        createdAt: '2026-07-25T01:10:00.000Z',
        updatedAt: '2026-07-25T01:10:00.000Z',
        activeSessionCount: 0,
        passkeyCount: 0,
      },
    ],
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

    if (pathname === '/api/v1/auth/methods' && method === 'GET') {
      return fulfillJson(route, {
        data: {
          passkey: true,
          password: true,
          oidc: state.oidcProvider.enabled
            ? {
                providerId: 'kuma-oidc',
                displayName: state.oidcProvider.displayName,
              }
            : null,
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

    if (
      ['/api/auth/sign-in/email', '/api/v1/auth/sign-in'].includes(pathname) &&
      method === 'POST'
    ) {
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

    if (pathname === '/api/v1/admin/users' && method === 'GET') {
      return fulfillJson(route, { data: state.users });
    }

    const userSessions = pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)\/sessions$/);
    if (userSessions && method === 'GET') {
      const userId = decodeURIComponent(userSessions[1] ?? '');
      return fulfillJson(route, {
        data:
          userId === 'owner-e2e-reference'
            ? [
                {
                  id: 'session-owner-reference',
                  userId,
                  createdAt: '2026-07-25T01:00:00.000Z',
                  updatedAt: '2026-07-25T01:00:00.000Z',
                  expiresAt: '2026-07-26T01:00:00.000Z',
                  current: true,
                },
              ]
            : [],
      });
    }

    if (pathname === '/api/v1/admin/security/oidc' && method === 'GET') {
      return fulfillJson(route, { data: state.oidcProvider });
    }

    if (pathname === '/api/v1/admin/security/oidc' && method === 'PUT') {
      recordMutationBoundary(route, state);
      const input = parseBody<{
        expectedVersion: number;
        displayName: string;
        discoveryUrl: string;
        clientId: string;
        clientSecret?: string;
        tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post';
      }>(route);
      state.oidcProvider = {
        enabled: true,
        configured: true,
        displayName: input.displayName,
        discoveryUrl: input.discoveryUrl,
        issuer: 'https://id.example.com/',
        clientId: input.clientId,
        clientSecretConfigured:
          state.oidcProvider.clientSecretConfigured || Boolean(input.clientSecret),
        tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
        version: input.expectedVersion + 1,
      };
      return fulfillJson(route, { data: state.oidcProvider });
    }

    if (pathname === '/api/v1/admin/security/oidc/mappings' && method === 'GET') {
      return fulfillJson(route, { data: state.oidcMappings });
    }

    const oidcMapping = pathname.match(/^\/api\/v1\/admin\/security\/oidc\/mappings\/([^/]+)$/);
    if (oidcMapping && method === 'PUT') {
      recordMutationBoundary(route, state);
      const userId = decodeURIComponent(oidcMapping[1] ?? '');
      const user = state.users.find(candidate => candidate.id === userId);
      const input = parseBody<{ expectedSubject: string | null; subject: string }>(route);
      if (!user) return fulfillJson(route, { error: { code: 'NOT_FOUND' } }, 404);
      state.oidcMappings = state.oidcMappings.filter(mapping => mapping.userId !== userId);
      const mapping: AdminOidcMapping = {
        subject: input.subject,
        userId,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: '2026-07-25T02:00:00.000Z',
      };
      state.oidcMappings.push(mapping);
      return fulfillJson(route, { data: mapping });
    }

    if (oidcMapping && method === 'DELETE') {
      recordMutationBoundary(route, state);
      const userId = decodeURIComponent(oidcMapping[1] ?? '');
      state.oidcMappings = state.oidcMappings.filter(mapping => mapping.userId !== userId);
      return fulfillJson(route, {
        data: { userId, removed: true, revokedSessions: 0 },
      });
    }

    if (pathname === '/api/v1/meta' && method === 'GET') {
      return fulfillJson(route, {
        version: '2.0.0-e2e',
        schemaVersion: 20,
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
          mode: state.configMode,
          revision: state.configMode === 'managed' ? state.revision : null,
          contentHash:
            state.configMode === 'managed'
              ? `reference-revision-${state.revision}`
              : 'e2e-file-target-content-hash',
          loadedAt: '2026-07-25T02:00:00.000Z',
          reload: null,
          transition:
            state.configTransitionApplies.length === 0
              ? null
              : {
                  id: 'transition-e2e-reference',
                  from: 'managed',
                  to: 'file',
                  state: 'completed',
                  sourceHash: 'a'.repeat(64),
                  targetHash: 'e2e-file-target-content-hash',
                  targetRevision: null,
                  backupArtifactId: 'backup-e2e-reference',
                  errorCode: null,
                  createdAt: '2026-07-25T02:05:00.000Z',
                  completedAt: '2026-07-25T02:05:01.000Z',
                },
          fileConfigured: options.withConfigFile ?? false,
          managedBaseRevision: state.revision,
          compatibility: null,
        },
      });
    }

    if (
      pathname === '/api/v1/admin/config/transitions/file-source' &&
      method === 'GET' &&
      options.withConfigFile
    ) {
      return fulfillJson(route, {
        data: {
          path: '/run/secrets/kuma-mieru/config.yml',
          sha256: 'a'.repeat(64),
          sizeBytes: 1_024,
        },
      });
    }

    if (pathname === '/api/v1/admin/config/transitions/preview' && method === 'POST') {
      recordMutationBoundary(route, state);
      const input = parseBody<{
        expectedActiveRevision: number;
        source: { kind: 'file'; path: string; sha256: string };
      }>(route);
      return fulfillJson(route, {
        data: {
          previewToken: 'e2e-config-transition-preview-token',
          expiresAt: '2026-07-25T02:10:00.000Z',
          from: 'managed',
          to: 'file',
          expectedActiveRevision: input.expectedActiveRevision,
          sourceHash: input.source.sha256,
          targetContentHash: 'e2e-file-target-content-hash',
          targetParentRevision: state.revision,
          diff: {
            sources: { added: ['llm-regional'], removed: [], changed: [] },
            pages: { added: [], removed: [], changed: [] },
            settings: { added: [], removed: [], changed: [] },
          },
          conflicts: [],
          unmigratableFields: [],
        },
      });
    }

    if (pathname === '/api/v1/admin/config/transitions/apply' && method === 'POST') {
      recordMutationBoundary(route, state);
      const input = parseBody<AdminApiState['configTransitionApplies'][number]>(route);
      state.configTransitionApplies.push(input);
      state.configMode = 'file';
      return fulfillJson(route, {
        data: {
          transitionId: 'transition-e2e-reference',
          state: 'completed',
          mode: 'file',
          revision: null,
          contentHash: 'e2e-file-target-content-hash',
          backupArtifactId: 'backup-e2e-reference',
          recovered: false,
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

    if (pathname === '/api/v1/admin/event-templates' && method === 'GET') {
      return fulfillJson(route, { data: state.eventTemplates });
    }

    if (pathname === '/api/v1/admin/recurring-maintenance-plans' && method === 'GET') {
      return fulfillJson(route, { data: state.recurringMaintenancePlans });
    }

    if (pathname === '/api/v1/admin/recurring-maintenance-plans' && method === 'POST') {
      recordMutationBoundary(route, state);
      const input = parseBody<{
        pageId: string;
        name: string;
        title: string;
        body: string;
        affectedComponentIds: string[];
        timeBasis: 'utc';
        frequency: 'daily' | 'weekly';
        interval: number;
        weekdays: number[];
        anchorStartAt: string;
        durationMinutes: number;
        endsAt: string | null;
      }>(route);
      const recordedAt = '2026-07-25T02:00:00.000Z';
      const plan: AdminRecurringMaintenancePlan = {
        id: `recurring-plan-${state.recurringMaintenancePlans.length + 1}`,
        pageId: input.pageId,
        name: input.name,
        state: 'active',
        version: 1,
        title: input.title,
        body: input.body,
        affectedComponentIds: input.affectedComponentIds,
        schedule: {
          timeBasis: input.timeBasis,
          frequency: input.frequency,
          interval: input.interval,
          weekdays: input.weekdays,
          anchorStartAt: input.anchorStartAt,
          durationMinutes: input.durationMinutes,
          endsAt: input.endsAt,
        },
        nextOccurrenceAt: input.anchorStartAt,
        createdBy: `${state.role}-e2e-reference`,
        createdAt: recordedAt,
        updatedAt: recordedAt,
      };
      state.recurringMaintenancePlans.unshift(plan);
      return fulfillJson(
        route,
        {
          data: {
            plan,
            materialization: {
              planId: plan.id,
              planVersion: plan.version,
              evaluatedAt: recordedAt,
              horizonAt: '2026-08-29T02:00:00.000Z',
              materializedOccurrences: 3,
              existingOccurrences: 0,
              nextOccurrenceAt: plan.nextOccurrenceAt,
              hasMore: false,
            },
          },
        },
        201
      );
    }

    const recurringMaintenanceUpdate = pathname.match(
      /^\/api\/v1\/admin\/recurring-maintenance-plans\/([^/]+)\/updates$/
    );
    if (recurringMaintenanceUpdate && method === 'POST') {
      recordMutationBoundary(route, state);
      const planId = decodeURIComponent(recurringMaintenanceUpdate[1] ?? '');
      const index = state.recurringMaintenancePlans.findIndex(plan => plan.id === planId);
      if (index < 0) {
        return fulfillJson(route, { error: { code: 'RECURRING_MAINTENANCE_NOT_FOUND' } }, 404);
      }
      const current = state.recurringMaintenancePlans[index] as AdminRecurringMaintenancePlan;
      const input = parseBody<{
        expectedVersion: number;
        state: RecurringMaintenancePlanState;
        name: string;
        title: string;
        body: string;
        affectedComponentIds: string[];
        timeBasis: 'utc';
        frequency: 'daily' | 'weekly';
        interval: number;
        weekdays: number[];
        anchorStartAt: string;
        durationMinutes: number;
        endsAt: string | null;
      }>(route);
      if (input.expectedVersion !== current.version) {
        return fulfillJson(
          route,
          { error: { code: 'RECURRING_MAINTENANCE_VERSION_CONFLICT' } },
          409
        );
      }
      const version = current.version + 1;
      const recordedAt = '2026-07-25T02:05:00.000Z';
      const updated: AdminRecurringMaintenancePlan = {
        ...current,
        name: input.name,
        state: input.state,
        version,
        title: input.title,
        body: input.body,
        affectedComponentIds: input.affectedComponentIds,
        schedule: {
          timeBasis: input.timeBasis,
          frequency: input.frequency,
          interval: input.interval,
          weekdays: input.weekdays,
          anchorStartAt: input.anchorStartAt,
          durationMinutes: input.durationMinutes,
          endsAt: input.endsAt,
        },
        nextOccurrenceAt: input.state === 'active' ? input.anchorStartAt : null,
        updatedAt: recordedAt,
      };
      state.recurringMaintenancePlans[index] = updated;
      return fulfillJson(route, {
        data: {
          plan: updated,
          materialization: {
            planId: updated.id,
            planVersion: updated.version,
            evaluatedAt: recordedAt,
            horizonAt: '2026-08-29T02:00:00.000Z',
            materializedOccurrences: 0,
            existingOccurrences: 3,
            nextOccurrenceAt: updated.nextOccurrenceAt,
            hasMore: false,
          },
        },
      });
    }

    const recurringMaintenanceMaterialize = pathname.match(
      /^\/api\/v1\/admin\/recurring-maintenance-plans\/([^/]+)\/materialize$/
    );
    if (recurringMaintenanceMaterialize && method === 'POST') {
      recordMutationBoundary(route, state);
      const planId = decodeURIComponent(recurringMaintenanceMaterialize[1] ?? '');
      const plan = state.recurringMaintenancePlans.find(candidate => candidate.id === planId);
      if (!plan) {
        return fulfillJson(route, { error: { code: 'RECURRING_MAINTENANCE_NOT_FOUND' } }, 404);
      }
      return fulfillJson(route, {
        data: {
          planId: plan.id,
          planVersion: plan.version,
          evaluatedAt: '2026-07-25T02:05:00.000Z',
          horizonAt: '2026-08-29T02:05:00.000Z',
          materializedOccurrences: 0,
          existingOccurrences: 3,
          nextOccurrenceAt: plan.nextOccurrenceAt,
          hasMore: false,
        },
      });
    }

    if (pathname === '/api/v1/admin/event-templates' && method === 'POST') {
      recordMutationBoundary(route, state);
      const input = parseBody<{
        name: string;
        eventType: EventTemplateType;
        title: string;
        body: string;
        affectedComponentIds: string[];
        defaultNotifySubscribers: boolean;
        noticeKind: 'information' | 'warning' | null;
      }>(route);
      const version = 1;
      const recordedAt = '2026-07-25T02:00:00.000Z';
      const template: AdminEventTemplate = {
        id: `template-${state.eventTemplates.length + 1}`,
        ...input,
        state: 'active',
        version,
        createdBy: `${state.role}-e2e-reference`,
        createdAt: recordedAt,
        updatedAt: recordedAt,
        latestEntry: {
          sequence: version,
          state: 'active',
          name: input.name,
          title: input.title,
          body: input.body,
          affectedComponentIds: input.affectedComponentIds,
          defaultNotifySubscribers: input.defaultNotifySubscribers,
          noticeKind: input.noticeKind,
          recordedAt,
          actorId: `${state.role}-e2e-reference`,
        },
      };
      state.eventTemplates.unshift(template);
      return fulfillJson(route, { data: template }, 201);
    }

    const eventTemplateUpdate = pathname.match(
      /^\/api\/v1\/admin\/event-templates\/([^/]+)\/updates$/
    );
    if (eventTemplateUpdate && method === 'POST') {
      recordMutationBoundary(route, state);
      const templateId = decodeURIComponent(eventTemplateUpdate[1] ?? '');
      const index = state.eventTemplates.findIndex(template => template.id === templateId);
      if (index < 0) {
        return fulfillJson(route, { error: { code: 'EVENT_TEMPLATE_NOT_FOUND' } }, 404);
      }
      const current = state.eventTemplates[index] as AdminEventTemplate;
      const input = parseBody<{
        expectedVersion: number;
        state: EventTemplateState;
        name: string;
        eventType: EventTemplateType;
        title: string;
        body: string;
        affectedComponentIds: string[];
        defaultNotifySubscribers: boolean;
        noticeKind: 'information' | 'warning' | null;
      }>(route);
      if (input.expectedVersion !== current.version) {
        return fulfillJson(route, { error: { code: 'EVENT_TEMPLATE_VERSION_CONFLICT' } }, 409);
      }
      const { expectedVersion: _expectedVersion, ...next } = input;
      const version = current.version + 1;
      const recordedAt = '2026-07-25T02:05:00.000Z';
      const updated: AdminEventTemplate = {
        ...current,
        ...next,
        version,
        updatedAt: recordedAt,
        latestEntry: {
          sequence: version,
          state: next.state,
          name: next.name,
          title: next.title,
          body: next.body,
          affectedComponentIds: next.affectedComponentIds,
          defaultNotifySubscribers: next.defaultNotifySubscribers,
          noticeKind: next.noticeKind,
          recordedAt,
          actorId: `${state.role}-e2e-reference`,
        },
      };
      state.eventTemplates[index] = updated;
      return fulfillJson(route, { data: updated });
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
        template?: { id: string; version: number };
      }>(route);
      const sourceTemplate = input.template
        ? state.eventTemplates.find(
            template =>
              template.id === input.template?.id &&
              template.version === input.template.version &&
              template.state === 'active' &&
              template.eventType === 'incident'
          )
        : null;
      if (input.template && !sourceTemplate) {
        return fulfillJson(route, { error: { code: 'EVENT_TEMPLATE_VERSION_CONFLICT' } }, 409);
      }
      const incident: AdminIncident = {
        ...referenceIncident,
        id: `incident-${state.incidents.length + 1}`,
        pageId: input.pageId,
        title: input.title,
        createdBy: `${state.role}-e2e-reference`,
        template: sourceTemplate
          ? {
              id: sourceTemplate.id,
              version: sourceTemplate.version,
              defaultNotifySubscribers: sourceTemplate.defaultNotifySubscribers,
            }
          : null,
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

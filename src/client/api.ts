import type { PublicStatus } from './status-presentation';

export interface PublicPage {
  id: string;
  slug: string;
  title: string;
  sourceRefs: string[];
}

export interface RuntimeMeta {
  version: string;
  schemaVersion: number;
  config: {
    mode: 'compatibility' | 'managed' | 'file';
    revision: number | null;
    contentHash: string;
    loadedAt: string;
    reload: {
      state: 'ready' | 'checking' | 'failed';
      lastAttemptAt: string | null;
      lastSuccessAt: string;
      lastErrorCode: string | null;
    } | null;
  };
  capabilities: {
    managedConfig: boolean;
    fileConfig: boolean;
    legacyEnvironment: boolean;
    sourceAdapters: string[];
    emailSubscriptions: boolean;
  };
}

export interface SourceSnapshotState {
  snapshot: {
    sourceId: string;
    pageId: string;
    title: string;
    description: string;
    status: PublicStatus;
    fetchedAt: string;
    extensions: Record<string, unknown>;
    capabilities: {
      currentStatus: boolean;
      heartbeatSeries: boolean;
      latencySeries: boolean;
      uptimeWindows: string[];
      incidents: 'none' | 'current' | 'history';
      maintenance: boolean;
      groups: boolean;
      tags: boolean;
      nativeMetrics: boolean;
      historicalDays: number | null;
    };
    groups: Array<{ id: string; name: string; position: number; serviceIds: string[] }>;
    services: Array<{
      id: string;
      sourceId: string;
      upstreamId: string;
      name: string;
      groupId: string;
      tags: Array<{ name: string; value?: string; color: string }>;
      status: PublicStatus;
      rawStatus: string | number;
      latencyMs: number | null;
      observedAt: string | null;
      uptime24h: number | null;
    }>;
    incidents: Array<{
      id: string;
      sourceEventId: string;
      kind: 'incident' | 'maintenance';
      title: string;
      content: string;
      severity: string;
    }>;
  };
  health: {
    state: 'healthy' | 'stale' | 'unavailable';
    stale: boolean;
    staleAfter: string;
    lastSuccessAt: string | null;
    errorCode: string | null;
  };
}

export type PublicDataResource = 'snapshot' | 'events' | 'mirrored-events';

export interface PublicDataIssue {
  resource: PublicDataResource;
  message: string;
}

const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const mutateJson = async <T>(
  path: string,
  method: 'POST' | 'PATCH',
  body?: unknown
): Promise<T> => {
  const response = await fetch(path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export const loadPublicBootstrap = async () => {
  const [meta, pages] = await Promise.all([
    getJson<RuntimeMeta>('/api/v1/meta'),
    getJson<{ data: PublicPage[] }>('/api/v1/public/pages'),
  ]);
  return { meta, pages: pages.data };
};

export const loadStatusSnapshot = async ({
  params,
}: {
  params: Record<string, string | undefined>;
}) => {
  const slug = params.pageSlug ?? params.pageId;
  if (!slug) return null;
  const response = await fetch(`/api/v1/public/pages/${encodeURIComponent(slug)}/snapshot`, {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 503) return null;
  if (!response.ok) throw new Error(`Snapshot request failed with status ${response.status}`);
  return response.json() as Promise<{
    data: SourceSnapshotState[];
    meta: { status: 'ok' | 'partial' };
  }>;
};

export interface PublicMirroredEvent {
  id: string;
  origin: 'mirrored';
  notificationEligible: false;
  type: 'incident' | 'maintenance';
  presence: 'present' | 'absent';
  version: number;
  title: string;
  content: string;
  severity: 'info' | 'warning' | 'danger' | 'unknown';
  startedAt: string | null;
  sourceUpdatedAt: string | null;
  rawStatus: string;
  firstSeenAt: string;
  lastSeenAt: string;
  absentAt: string | null;
  updatedAt: string;
  source: {
    id: string;
    pageId: string;
    eventId: string;
    url: string | null;
  };
}

interface PublicPublicationBase {
  publicationId: string;
  eventId: string;
  eventSequence: number;
  pageId: string;
  title: string;
  body: string;
  affectedComponentIds: string[];
  occurredAt: string;
  recordedAt: string;
  publishedAt: string;
}

export type PublicPublication =
  | (PublicPublicationBase & {
      type: 'incident';
      state: 'investigating' | 'identified' | 'monitoring' | 'resolved';
    })
  | (PublicPublicationBase & {
      type: 'maintenance';
      state: 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
      scheduledStartAt: string;
      scheduledEndAt: string;
    })
  | (PublicPublicationBase & {
      type: 'notice';
      state: 'draft' | 'published' | 'expired' | 'withdrawn';
      kind: 'information' | 'warning';
      startsAt: string | null;
      endsAt: string | null;
    })
  | (PublicPublicationBase & {
      type: 'postmortem';
      state: 'draft' | 'reviewed' | 'published';
      incidentId: string;
    });

export const loadStatusPage = async (input: { params: Record<string, string | undefined> }) => {
  const slug = input.params.pageSlug ?? input.params.pageId;
  if (!slug) return { snapshot: null, publications: [], mirroredEvents: [], issues: [] };

  const capture = async <T>(
    resource: PublicDataResource,
    request: Promise<T>
  ): Promise<{ data: T | null; issue: PublicDataIssue | null }> => {
    try {
      return { data: await request, issue: null };
    } catch {
      return {
        data: null,
        issue: {
          resource,
          message: `The public ${resource} resource is temporarily unavailable.`,
        },
      };
    }
  };

  const [snapshotResult, publicationsResult, mirroredResult] = await Promise.all([
    capture('snapshot', loadStatusSnapshot(input)),
    capture(
      'events',
      getJson<{ data: PublicPublication[] }>(
        `/api/v1/public/pages/${encodeURIComponent(slug)}/events`
      )
    ),
    capture(
      'mirrored-events',
      getJson<{ data: PublicMirroredEvent[] }>(
        `/api/v1/public/pages/${encodeURIComponent(slug)}/mirrored-events`
      )
    ),
  ]);

  return {
    snapshot: snapshotResult.data,
    publications: publicationsResult.data?.data ?? [],
    mirroredEvents: mirroredResult.data?.data ?? [],
    issues: [snapshotResult.issue, publicationsResult.issue, mirroredResult.issue].filter(
      (issue): issue is PublicDataIssue => issue !== null
    ),
  };
};

export type StatusPagePayload = Awaited<ReturnType<typeof loadStatusPage>>;

export type PublicBootstrap = Awaited<ReturnType<typeof loadPublicBootstrap>>;

const publicPageSlug = (params: Record<string, string | undefined>) => {
  const slug = params.pageSlug ?? params.pageId;
  if (!slug) throw new Error('Status page route is incomplete');
  return slug;
};

export const loadPublicHistory = async (input: { params: Record<string, string | undefined> }) => {
  const slug = publicPageSlug(input.params);
  const [publications, mirrored] = await Promise.all([
    getJson<{ data: PublicPublication[] }>(
      `/api/v1/public/pages/${encodeURIComponent(slug)}/events`
    ),
    getJson<{ data: PublicMirroredEvent[] }>(
      `/api/v1/public/pages/${encodeURIComponent(slug)}/mirrored-events`
    ),
  ]);
  return { publications: publications.data, mirroredEvents: mirrored.data };
};

export const loadPublicNotices = async (input: { params: Record<string, string | undefined> }) => {
  const slug = publicPageSlug(input.params);
  const notices = await getJson<{ data: PublicPublication[] }>(
    `/api/v1/public/pages/${encodeURIComponent(slug)}/notices`
  );
  return {
    publications: notices.data.filter(
      (publication): publication is Extract<PublicPublication, { type: 'notice' }> =>
        publication.type === 'notice'
    ),
  };
};

export const loadPublicSubscribe = async (input: {
  params: Record<string, string | undefined>;
}) => {
  const pageSlug = publicPageSlug(input.params);
  return {
    pageSlug,
    snapshot: await loadStatusSnapshot({ params: { pageSlug } }),
  };
};

export const loadPublicServiceDetail = async (input: {
  params: Record<string, string | undefined>;
}) => {
  const pageSlug = publicPageSlug(input.params);
  const serviceId = input.params.serviceId;
  if (!serviceId) throw new Error('Service route is incomplete');
  const [snapshot, publications] = await Promise.all([
    loadStatusSnapshot({ params: { pageSlug } }),
    getJson<{ data: PublicPublication[] }>(
      `/api/v1/public/pages/${encodeURIComponent(pageSlug)}/events`
    ),
  ]);
  const matches =
    snapshot?.data.flatMap(source =>
      source.snapshot.services
        .filter(service => service.id === serviceId)
        .map(service => ({ service, source }))
    ) ?? [];
  if (matches.length === 0) throw new Error('Public service not found');
  return {
    pageSlug,
    serviceId,
    matches,
    publications: publications.data.filter(publication =>
      publication.affectedComponentIds.includes(serviceId)
    ),
  };
};

export const loadPublicEventDetail = async (input: {
  params: Record<string, string | undefined>;
  request: Request;
}) => {
  const slug = input.params.pageSlug;
  const eventId = input.params.eventId;
  if (!slug || !eventId) throw new Error('Event route is incomplete');
  const kind = new URL(input.request.url).pathname.includes('/maintenance/')
    ? 'maintenance'
    : 'incident';
  const publications = await getJson<{ data: PublicPublication[] }>(
    `/api/v1/public/pages/${encodeURIComponent(slug)}/${kind === 'maintenance' ? 'maintenance' : 'incidents'}/${encodeURIComponent(eventId)}`
  );
  const data = publications.data.filter(
    (publication): publication is PublicPublication =>
      publication.type === kind && publication.eventId === eventId
  );
  if (data.length === 0) throw new Error('Published event not found');
  const postmortems =
    kind === 'incident'
      ? await getJson<{ data: PublicPublication[] }>(
          `/api/v1/public/pages/${encodeURIComponent(slug)}/incidents/${encodeURIComponent(eventId)}/postmortems`
        )
      : { data: [] };
  return { kind, publications: data, postmortems: postmortems.data };
};

export interface SubscriptionTokenView {
  subscriptionId: string;
  purpose: 'confirm' | 'manage' | 'unsubscribe';
  pageId: string;
  incidentId: string | null;
  componentIds: string[];
  state: 'pending_confirmation' | 'active' | 'unsubscribed' | 'suppressed' | 'expired';
  expiresAt: string;
}

export type SubscriptionPurpose = SubscriptionTokenView['purpose'];

export const requestPublicEmailSubscription = async (
  pageSlug: string,
  input: { email: string; componentIds: string[]; incidentId?: string; website?: string }
) => {
  const nonce = await getJson<{ data: { nonce: string; expiresAt: string } }>(
    `/api/v1/public/pages/${encodeURIComponent(pageSlug)}/subscriptions/email/nonce`
  );
  return mutateJson<{ data: { accepted: true; message: string } }>(
    `/api/v1/public/pages/${encodeURIComponent(pageSlug)}/subscriptions/email`,
    'POST',
    { ...input, nonce: nonce.data.nonce }
  );
};

export const loadSubscriptionAction = async (input: {
  params: Record<string, string | undefined>;
}) => {
  const token = input.params.token;
  if (!token) throw new Error('Subscription token is missing');
  const purpose = input.params.purpose as SubscriptionPurpose | undefined;
  if (!purpose || !['confirm', 'manage', 'unsubscribe'].includes(purpose)) {
    throw new Error('Subscription action is invalid');
  }
  const response = await getJson<{ data: SubscriptionTokenView }>(
    `/api/v1/public/subscriptions/${purpose}/${encodeURIComponent(token)}`
  );
  const bootstrap = await loadPublicBootstrap();
  const page = bootstrap.pages.find(candidate => candidate.id === response.data.pageId);
  const snapshot = page ? await loadStatusSnapshot({ params: { pageSlug: page.slug } }) : null;
  return {
    token,
    purpose,
    view: response.data,
    page,
    services:
      snapshot?.data.flatMap(source =>
        source.snapshot.services.map(service => ({ id: service.id, name: service.name }))
      ) ?? [],
  };
};

export const confirmPublicEmailSubscription = (token: string) =>
  mutateJson<{ data: SubscriptionTokenView }>(
    `/api/v1/public/subscriptions/confirm/${encodeURIComponent(token)}`,
    'POST'
  );

export const updatePublicEmailSubscription = (
  token: string,
  input: { componentIds: string[]; incidentId: string | null }
) =>
  mutateJson<{ data: SubscriptionTokenView }>(
    `/api/v1/public/subscriptions/manage/${encodeURIComponent(token)}`,
    'PATCH',
    input
  );

export const unsubscribePublicEmail = (token: string) =>
  mutateJson<{ data: { unsubscribed: true } }>(
    `/api/v1/public/subscriptions/unsubscribe/${encodeURIComponent(token)}`,
    'POST'
  );

export interface MetricDefinition {
  id: string;
  unit: string;
  minimumSamples: number | Record<string, number>;
  requiredScenario?: string;
  presentationHint?: string;
}

export interface MetricCatalogSource {
  sourceId: string;
  pageId: string;
  metrics: MetricDefinition[];
  windows: Array<{
    window: '5m' | '1h' | '1d' | '7d' | '30d';
    fetchedAt: string;
    staleAfter: string;
    stale: boolean;
  }>;
}

export interface MetricPoint {
  window: { start: string; end: string };
  dimensions: Record<string, string | number | boolean | null>;
  protocolVersion: string;
  sampleCount: number;
  eligibleCount: number;
  value: Record<string, unknown>;
  freshness: {
    state: string;
    observedAt?: string | null;
    staleAfter?: string | null;
  };
  coverageState: string;
  limitations: string[];
}

export interface MetricSeries {
  sourceId: string;
  pageId: string;
  metricId: string;
  unit: string;
  window: string;
  generatedAt: string;
  fetchedAt: string;
  staleAfter: string;
  stale: boolean;
  points: MetricPoint[];
}

export interface MethodologySnapshot {
  methodologyVersion: string;
  generatedAt: string;
  product: Record<string, unknown>;
  sourceKinds: string[];
  statusSemantics: Record<string, unknown>;
  freshnessPolicy: Record<string, unknown>;
  protocols: Array<Record<string, unknown>>;
  metrics: Array<Record<string, unknown>>;
  coverage: Array<Record<string, unknown>>;
  limitations: string[];
  evidenceLinks: string[];
  [key: string]: unknown;
}

export interface MethodologySource {
  sourceId: string;
  pageId: string;
  fetchedAt: string;
  staleAfter: string;
  stale: boolean;
  snapshot: MethodologySnapshot;
}

export const loadMetricCatalog = async (slug: string) =>
  getJson<{ data: MetricCatalogSource[] }>(
    `/api/v1/public/pages/${encodeURIComponent(slug)}/metrics/catalog`
  );

export const loadMetricSeries = async (
  slug: string,
  input: { sourceId: string; metricId: string; window?: string }
) => {
  const query = new URLSearchParams({
    source: input.sourceId,
    metric: input.metricId,
    window: input.window ?? '5m',
  });
  return getJson<{ data: MetricSeries[] }>(
    `/api/v1/public/pages/${encodeURIComponent(slug)}/metrics/query?${query}`
  );
};

export const loadMethodology = async (slug: string) =>
  getJson<{ data: MethodologySource[]; meta: { status: 'ok' | 'stale' } }>(
    `/api/v1/public/pages/${encodeURIComponent(slug)}/methodology`
  );

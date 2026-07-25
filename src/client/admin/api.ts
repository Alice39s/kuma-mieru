export interface AdminSession {
  userId: string;
  role: 'owner' | 'publisher' | 'editor' | 'viewer';
  csrfToken: string;
}

interface AdminSourceBase {
  id: string;
  baseUrl: string;
  pageIds: string[];
  requestPolicy?: {
    timeoutMs?: number;
  };
}

export interface AdminSource extends AdminSourceBase {
  kind: 'uptime-kuma' | 'better-stack' | 'incident-io' | 'uptime-robot' | 'llm-mieru';
  authenticated: boolean;
}

export type AdminSourceCandidate = AdminSourceBase &
  (
    | { kind: 'uptime-kuma' | 'better-stack' | 'incident-io' }
    | { kind: 'uptime-robot'; secretRef: string }
    | { kind: 'llm-mieru'; secretRef?: string }
  );

export interface AdminPage {
  id: string;
  slug: string;
  title: string;
  sourceRefs: string[];
}

export interface AdminRevision {
  revision: number;
  contentHash: string;
  parentRevision: number | null;
  actor: string;
  createdAt: string;
}

export type IncidentState = 'investigating' | 'identified' | 'monitoring' | 'resolved';

export interface AdminIncident {
  id: string;
  type: 'incident';
  pageId: string;
  title: string;
  state: IncidentState;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  latestEntry: {
    sequence: number;
    state: IncidentState;
    title: string;
    body: string;
    affectedComponentIds: string[];
    occurredAt: string;
    recordedAt: string;
    actorId: string;
  };
}

type SharedEventEntry<State extends string> = {
  sequence: number;
  state: State;
  title: string;
  body: string;
  affectedComponentIds: string[];
  occurredAt: string;
  recordedAt: string;
  actorId: string;
};

interface SharedAdminEvent<Type extends string, State extends string> {
  id: string;
  type: Type;
  pageId: string;
  title: string;
  state: State;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  latestEntry: SharedEventEntry<State>;
}

export type MaintenanceState = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export interface AdminMaintenance extends SharedAdminEvent<'maintenance', MaintenanceState> {
  scheduledStartAt: string;
  scheduledEndAt: string;
}

export type NoticeState = 'draft' | 'published' | 'expired' | 'withdrawn';
export interface AdminNotice extends SharedAdminEvent<'notice', NoticeState> {
  kind: 'information' | 'warning';
  startsAt: string | null;
  endsAt: string | null;
}

export type PostmortemState = 'draft' | 'reviewed' | 'published';
export interface AdminPostmortem extends SharedAdminEvent<'postmortem', PostmortemState> {
  incidentId: string;
}

export type AdminNativeEvent = AdminIncident | AdminMaintenance | AdminNotice | AdminPostmortem;

export interface AdminMirroredEvent {
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
    url: string;
  };
}

export type SubscriberState =
  | 'pending_confirmation'
  | 'active'
  | 'unsubscribed'
  | 'suppressed'
  | 'expired';
export interface AdminSubscriber {
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

export type DeliveryState = 'queued' | 'processing' | 'sent' | 'failed' | 'dead_letter';
export interface AdminDelivery {
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

export interface AdminSmtpConfiguration {
  enabled: boolean;
  host?: string;
  port?: number;
  tls?: 'implicit' | 'starttls';
  from?: { address: string; name?: string };
  replyTo?: string | null;
  authenticated?: boolean;
}

export interface AdminSmtpStatus {
  runtime: {
    state: 'disabled' | 'running' | 'failed';
    configured: boolean;
    appliedAt: string;
    lastErrorCode: string | null;
  };
  configuration: AdminSmtpConfiguration;
}

export interface AdminSmtpCandidate {
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

interface ReloadStatus {
  state: 'ready' | 'checking' | 'failed';
  lastAttemptAt: string | null;
  lastSuccessAt: string;
  lastErrorCode: string | null;
}

export interface AdminMeta {
  version: string;
  schemaVersion: number;
  config: {
    mode: 'managed' | 'file' | 'compatibility';
    revision: number | null;
    contentHash: string;
    loadedAt: string;
    reload: (ReloadStatus & { failedHash: string | null }) | null;
    compatibility: {
      source: 'environment_urls' | 'environment_base' | 'generated_json';
      contentHash: string;
      decisions: Array<{
        key: string;
        status: 'mapped' | 'ignored_by_precedence' | 'accepted_no_effect';
        target: string;
        note: string;
      }>;
      conflicts: string[];
      ignoredFields: string[];
    } | null;
  };
}

type PublicMeta = Omit<AdminMeta, 'config'> & {
  config: Omit<AdminMeta['config'], 'reload'> & { reload: ReloadStatus | null };
};

interface ErrorEnvelope {
  error?: { code?: string; message?: string; requestId?: string };
}

export interface ApiFailure extends Error {
  status: number;
  code: string;
  requestId?: string;
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & ErrorEnvelope;
  if (!response.ok) {
    throw Object.assign(
      new Error(body.error?.message ?? `Request failed with status ${response.status}`),
      {
        status: response.status,
        code: body.error?.code ?? 'REQUEST_FAILED',
        requestId: body.error?.requestId,
      }
    ) satisfies ApiFailure;
  }
  return body;
};

const mutationHeaders = (session: AdminSession) => ({
  'Content-Type': 'application/json',
  'X-Kuma-CSRF': session.csrfToken,
});

export const getSetupStatus = () =>
  request<{ data: { required: boolean; available: boolean; expiresAt: string | null } }>(
    '/api/v1/setup/status'
  );

export const createOwner = (input: {
  token: string;
  email: string;
  name: string;
  password: string;
}) =>
  request<{ data: { userId: string; role: 'owner' } }>('/api/v1/setup/owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

export const signIn = (input: { email: string; password: string }) =>
  request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

export const signOut = () => request('/api/auth/sign-out', { method: 'POST' });

export const getAdminSession = async () =>
  (await request<{ data: AdminSession }>('/api/v1/admin/session')).data;

export const getWorkbenchData = async () => {
  const [
    meta,
    configStatus,
    sources,
    pages,
    revisions,
    incidents,
    mirroredEvents,
    maintenances,
    notices,
    postmortems,
  ] = await Promise.all([
    request<PublicMeta>('/api/v1/meta'),
    request<{ data: AdminMeta['config'] }>('/api/v1/admin/config/status'),
    request<{ data: AdminSource[] }>('/api/v1/admin/sources'),
    request<{ data: AdminPage[] }>('/api/v1/admin/pages'),
    request<{ data: AdminRevision[] }>('/api/v1/admin/config/revisions'),
    request<{ data: AdminIncident[] }>('/api/v1/admin/events'),
    request<{ data: AdminMirroredEvent[] }>('/api/v1/admin/mirrored-events'),
    request<{ data: AdminMaintenance[] }>('/api/v1/admin/maintenances'),
    request<{ data: AdminNotice[] }>('/api/v1/admin/notices'),
    request<{ data: AdminPostmortem[] }>('/api/v1/admin/postmortems'),
  ]);
  const events: AdminNativeEvent[] = [
    ...incidents.data,
    ...maintenances.data,
    ...notices.data,
    ...postmortems.data,
  ].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return {
    meta: { ...meta, config: configStatus.data },
    sources: sources.data,
    pages: pages.data,
    revisions: revisions.data,
    incidents: incidents.data,
    mirroredEvents: mirroredEvents.data,
    events,
  };
};

export const createIncident = (
  session: AdminSession,
  input: {
    pageId: string;
    title: string;
    body: string;
    affectedComponentIds: string[];
  }
) =>
  request<{ data: AdminIncident }>('/api/v1/admin/incidents', {
    method: 'POST',
    headers: { ...mutationHeaders(session), 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(input),
  });

export const appendIncidentUpdate = (
  session: AdminSession,
  eventId: string,
  input: {
    expectedVersion: number;
    state: IncidentState;
    body: string;
    affectedComponentIds: string[];
  }
) =>
  request<{ data: AdminIncident }>(`/api/v1/admin/incidents/${eventId}/updates`, {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

export const reviewIncidentPublication = (
  session: AdminSession,
  eventId: string,
  input: { expectedVersion: number; notifySubscribers: boolean }
) =>
  request<{
    data: {
      incident: AdminIncident;
      notifySubscribers: boolean;
      estimatedRecipients: number;
      reviewNonce: string;
      expiresAt: string;
    };
  }>(`/api/v1/admin/incidents/${eventId}/review`, {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

export const publishIncident = (
  session: AdminSession,
  eventId: string,
  input: { expectedVersion: number; notifySubscribers: boolean; reviewNonce: string }
) =>
  request<{ data: { publicationId: string; publishedAt: string } }>(
    `/api/v1/admin/incidents/${eventId}/publish`,
    {
      method: 'POST',
      headers: mutationHeaders(session),
      body: JSON.stringify(input),
    }
  );

type SecondaryEventType = 'maintenance' | 'notice' | 'postmortem';
export type SecondaryEvent = AdminMaintenance | AdminNotice | AdminPostmortem;

export const createSecondaryEvent = (
  session: AdminSession,
  type: SecondaryEventType,
  input: Record<string, unknown>
) =>
  request<{ data: SecondaryEvent }>(
    `/api/v1/admin/${type === 'maintenance' ? 'maintenances' : `${type}s`}`,
    {
      method: 'POST',
      headers: { ...mutationHeaders(session), 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(input),
    }
  );

const secondaryEventPath = (type: SecondaryEventType) =>
  type === 'maintenance' ? 'maintenances' : `${type}s`;

export const appendSecondaryEventUpdate = (
  session: AdminSession,
  event: SecondaryEvent,
  input: Record<string, unknown>
) =>
  request<{ data: SecondaryEvent }>(
    `/api/v1/admin/${secondaryEventPath(event.type)}/${event.id}/updates`,
    {
      method: 'POST',
      headers: mutationHeaders(session),
      body: JSON.stringify(input),
    }
  );

export const reviewSecondaryEventPublication = (
  session: AdminSession,
  event: SecondaryEvent,
  input: { expectedVersion: number; notifySubscribers: boolean }
) =>
  request<{
    data: {
      estimatedRecipients: number;
      reviewNonce: string;
      expiresAt: string;
    };
  }>(`/api/v1/admin/${secondaryEventPath(event.type)}/${event.id}/review`, {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

export const publishSecondaryEvent = (
  session: AdminSession,
  event: SecondaryEvent,
  input: { expectedVersion: number; notifySubscribers: boolean; reviewNonce: string }
) =>
  request<{ data: { publicationId: string; publishedAt: string } }>(
    `/api/v1/admin/${secondaryEventPath(event.type)}/${event.id}/publish`,
    {
      method: 'POST',
      headers: mutationHeaders(session),
      body: JSON.stringify(input),
    }
  );

export const getSubscriberDeliveryData = async () => {
  const [subscribers, deliveries, smtp] = await Promise.all([
    request<{ data: AdminSubscriber[] }>('/api/v1/admin/subscribers'),
    request<{ data: AdminDelivery[] }>('/api/v1/admin/deliveries'),
    request<{ data: AdminSmtpStatus }>('/api/v1/admin/delivery/smtp'),
  ]);
  return { subscribers: subscribers.data, deliveries: deliveries.data, smtp: smtp.data };
};

export const stageSmtpCredentials = (
  session: AdminSession,
  input: { username: string; password: string }
) =>
  request<{
    data: { credentialSetId: string; usernameRef: string; passwordRef: string };
  }>('/api/v1/admin/secrets/smtp-credentials', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

export const testSmtpConfiguration = (session: AdminSession, smtp: AdminSmtpCandidate) =>
  request<{ data: { token: string; expiresAt: string } }>('/api/v1/admin/delivery/smtp/test', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify({ smtp }),
  });

export const activateSmtpConfiguration = (
  session: AdminSession,
  input: {
    expectedRevision: number;
    smtp: AdminSmtpCandidate | { enabled: false };
    testToken?: string;
  }
) =>
  request<{ data: { revision: number; applyStatus: string } }>('/api/v1/admin/delivery/smtp', {
    method: 'PUT',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

export const sendSmtpTestMessage = (session: AdminSession, recipient: string) =>
  request<{ data: { messageId: string } }>('/api/v1/admin/delivery/smtp/send-test', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify({ recipient }),
  });

export const retryDelivery = (
  session: AdminSession,
  deliveryId: string,
  expectedState: 'failed' | 'dead_letter'
) =>
  request<{ data: AdminDelivery }>(`/api/v1/admin/deliveries/${deliveryId}/retry`, {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify({ expectedState }),
  });

export const suppressSubscriber = (
  session: AdminSession,
  subscriberId: string,
  expectedState: 'active'
) =>
  request<{ data: AdminSubscriber }>(`/api/v1/admin/subscribers/${subscriberId}/suppress`, {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify({ expectedState }),
  });

export const testSource = (session: AdminSession, source: AdminSourceCandidate) =>
  request<{
    data: {
      token: string;
      expiresAt: string;
      pages: Array<{ pageId: string; title: string; status: string; serviceCount: number }>;
    };
  }>('/api/v1/admin/sources/test', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify({ source }),
  });

export const putSourceToken = (session: AdminSession, resourceId: string, value: string) =>
  request<{
    data: {
      secretRef: string;
      resourceId: string;
      fieldName: string;
      purpose: string;
      keyId: string;
    };
  }>('/api/v1/admin/secrets/source-token', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify({ resourceId, value }),
  });

export const createSource = (
  session: AdminSession,
  input: { expectedRevision: number; source: AdminSourceCandidate; testToken: string }
) =>
  request<{ data: { revision: number; applyStatus: string } }>('/api/v1/admin/sources', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

export const createPage = (
  session: AdminSession,
  input: { expectedRevision: number; page: AdminPage }
) =>
  request<{ data: { revision: number; applyStatus: string } }>('/api/v1/admin/pages', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

export const rollbackRevision = (
  session: AdminSession,
  targetRevision: number,
  input: { expectedRevision: number; reason: string }
) =>
  request<{ data: { revision: number; applyStatus: string } }>(
    `/api/v1/admin/config/revisions/${targetRevision}/rollback`,
    {
      method: 'POST',
      headers: mutationHeaders(session),
      body: JSON.stringify(input),
    }
  );

export const reloadFileConfig = (session: AdminSession) =>
  request<{
    data: {
      outcome: 'unchanged' | 'applied';
      status: NonNullable<AdminMeta['config']['reload']>;
    };
  }>('/api/v1/admin/config/reload', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: '{}',
  });

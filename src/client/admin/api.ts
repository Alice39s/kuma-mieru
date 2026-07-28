import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

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

export interface AppliedEventTemplate {
  id: string;
  version: number;
  defaultNotifySubscribers: boolean;
}

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
  template: AppliedEventTemplate | null;
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
  template: AppliedEventTemplate | null;
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

export type EventTemplateType = AdminNativeEvent['type'];
export type EventTemplateState = 'active' | 'archived';
export interface AdminEventTemplate {
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

export type RecurringMaintenancePlanState = 'active' | 'paused' | 'archived';
export interface AdminRecurringMaintenancePlan {
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

export interface AdminRecurringMaintenanceMaterialization {
  planId: string;
  planVersion: number;
  evaluatedAt: string;
  horizonAt: string;
  materializedOccurrences: number;
  existingOccurrences: number;
  nextOccurrenceAt: string | null;
  hasMore: boolean;
}

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

export interface AdminAutomationSuggestion {
  id: string;
  origin: 'automation';
  notificationEligible: false;
  kind: 'degradation' | 'recovery';
  state: 'pending' | 'accepted' | 'ignored' | 'superseded';
  version: number;
  pageId: string;
  sourceId: string;
  sourcePageId: string;
  serviceId: string;
  serviceName: string;
  title: string;
  body: string;
  ruleVersion: string;
  evidence: {
    normalizedStatus: string;
    rawStatus: string | number;
    observedAt: string;
    consecutiveCount: number;
    requiredCount: number;
  };
  nativeEventId: string | null;
  nativeEventVersion: number | null;
  createdAt: string;
  updatedAt: string;
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

export interface AdminBackupManifest {
  formatVersion: 1;
  backupId: string;
  createdAt: string;
  appBuild: string;
  schemaVersion: number;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  purpose?: 'runtime-backup' | 'schema-upgrade';
  targetSchemaVersion?: number;
  migrationChecksums?: Array<{
    version: number;
    name: string;
    checksumSha256: string;
  }>;
}

export interface AdminBackupArtifact {
  id: string;
  state: 'creating' | 'ready' | 'failed';
  fileName: string;
  manifest: AdminBackupManifest | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
  retentionState: 'current' | 'eligible' | 'hold';
  retentionDecidedAt: string | null;
  manifestSha256: string | null;
  deletionState: 'staging' | 'staged' | 'completed' | null;
  deletedAt: string | null;
}

export interface AdminBackupValidation {
  backupId: string;
  valid: true;
  schemaVersion: number;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface AdminRetentionPolicy {
  eventDraftDays: number;
  adminAuditDays: number;
  deliveryAttemptDays: number;
  backupDays: number;
}

export interface AdminRetentionCutoffs {
  eventDraftBefore: string;
  adminAuditBefore: string;
  deliveryAttemptBefore: string;
  backupBefore: string;
  pendingConfirmationBefore: string;
  abuseHashBefore: string;
  expiredTokenBefore: string;
}

export interface AdminRetentionSummary {
  subscriberTombstonesApplied: number;
  pendingSubscriptionsExpired: number;
  terminalSubscriptionsRedacted: number;
  terminalDeliveryPayloadsRedacted: number;
  expiredSubscriptionTokensDeleted: number;
  deliveryAttemptsDeleted: number;
  abuseRateLimitBucketsDeleted: number;
  unpublishedTerminalEventsDeleted: number;
  adminAuditRowsDeleted: number;
  backupArtifactsMarkedEligible: number;
  backupArtifactsMarkedCurrent: number;
}

export interface AdminRetentionPreview {
  policyVersion: number;
  policy: AdminRetentionPolicy;
  cutoffs: AdminRetentionCutoffs;
  candidates: Omit<AdminRetentionSummary, 'subscriberTombstonesApplied'>;
}

export interface AdminRetentionRun {
  id: string;
  trigger: 'admin' | 'scheduler' | 'restore';
  actorId: string;
  state: 'running' | 'completed' | 'failed';
  policyVersion: number;
  cutoffs: AdminRetentionCutoffs;
  summary: AdminRetentionSummary | null;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
}

export type AdminAuditResult = 'success' | 'denied' | 'failed';

export interface AdminAuditEntry {
  id: string;
  occurredAt: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  result: AdminAuditResult;
  errorCode: string | null;
}

export interface AdminAuditPage {
  entries: AdminAuditEntry[];
  nextCursor: string | null;
}

export type AdminRole = AdminSession['role'];

export interface AdminUser {
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

export interface AdminUserSession {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface AdminPasskey {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: string | null;
}

export interface AdminControlApiKey {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  access: 'read-only' | 'manager';
  expiresAt: string | null;
  lastRequest: string | null;
  createdAt: string;
}

export interface CreatedAdminControlApiKey extends AdminControlApiKey {
  key: string;
}

export interface AdminTwoFactorStatus {
  enabled: boolean;
  setupPending: boolean;
  recoveryCodesConfigured: boolean;
}

export interface AdminOidcProvider {
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

export interface AdminOidcMapping {
  subject: string;
  userId: string;
  name: string;
  email: string;
  role: AdminRole;
  createdAt: string;
}

export interface AuthenticationMethods {
  passkey: true;
  password: true;
  oidc: {
    providerId: 'kuma-oidc';
    displayName: string;
  } | null;
}

export type SignInResult =
  | { state: 'authenticated' }
  | { state: 'two_factor_required'; methods: Array<'totp' | 'backup_code'> };

interface ReloadStatus {
  state: 'ready' | 'checking' | 'failed';
  lastAttemptAt: string | null;
  lastSuccessAt: string;
  lastErrorCode: string | null;
}

export interface AdminConfigTransitionStatus {
  id: string;
  from: string;
  to: string;
  state: 'pending' | 'completed' | 'failed';
  sourceHash: string;
  targetHash: string | null;
  targetRevision: number | null;
  backupArtifactId: string | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AdminConfigTransitionPreview {
  previewToken: string;
  expiresAt: string;
  from: 'managed' | 'file';
  to: 'managed' | 'file';
  expectedActiveRevision: number;
  sourceHash: string;
  targetContentHash: string;
  targetParentRevision: number | null;
  diff: {
    sources: { added: string[]; removed: string[]; changed: string[] };
    pages: { added: string[]; removed: string[]; changed: string[] };
    settings: { added: string[]; removed: string[]; changed: string[] };
  };
  conflicts: string[];
  unmigratableFields: string[];
}

export type AdminConfigTransitionSource =
  | { kind: 'managed'; revision: number }
  | { kind: 'file'; path: string; sha256: string };

export interface AdminMeta {
  version: string;
  schemaVersion: number;
  config: {
    mode: 'managed' | 'file' | 'compatibility';
    revision: number | null;
    contentHash: string;
    loadedAt: string;
    reload: (ReloadStatus & { failedHash: string | null }) | null;
    transition: AdminConfigTransitionStatus | null;
    fileConfigured: boolean;
    managedBaseRevision: number | null;
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
  request<{ data: SignInResult }>('/api/v1/auth/sign-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

export const getAuthenticationMethods = async () =>
  (await request<{ data: AuthenticationMethods }>('/api/v1/auth/methods')).data;

export const beginOidcSignIn = () =>
  request<{ data: { url: string } }>('/api/v1/auth/oidc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

export const verifySignInTotp = (input: { code: string; trustDevice: boolean }) =>
  request<{ data: { state: 'authenticated' } }>('/api/v1/auth/two-factor/totp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

export const verifySignInBackupCode = (input: { code: string; trustDevice: boolean }) =>
  request<{ data: { state: 'authenticated' } }>('/api/v1/auth/two-factor/backup-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

export const beginPasskeySignIn = () =>
  request<{ data: PublicKeyCredentialRequestOptionsJSON }>('/api/v1/auth/passkey/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

export const completePasskeySignIn = (
  response: Omit<AuthenticationResponseJSON, 'clientExtensionResults'>
) =>
  request<{ data: { state: 'authenticated' } }>('/api/v1/auth/passkey/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response }),
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
    automationSuggestions,
    maintenances,
    notices,
    postmortems,
    eventTemplates,
    recurringMaintenancePlans,
  ] = await Promise.all([
    request<PublicMeta>('/api/v1/meta'),
    request<{ data: AdminMeta['config'] }>('/api/v1/admin/config/status'),
    request<{ data: AdminSource[] }>('/api/v1/admin/sources'),
    request<{ data: AdminPage[] }>('/api/v1/admin/pages'),
    request<{ data: AdminRevision[] }>('/api/v1/admin/config/revisions'),
    request<{ data: AdminIncident[] }>('/api/v1/admin/events'),
    request<{ data: AdminMirroredEvent[] }>('/api/v1/admin/mirrored-events'),
    request<{ data: AdminAutomationSuggestion[] }>(
      '/api/v1/admin/automation/suggestions?state=pending'
    ),
    request<{ data: AdminMaintenance[] }>('/api/v1/admin/maintenances'),
    request<{ data: AdminNotice[] }>('/api/v1/admin/notices'),
    request<{ data: AdminPostmortem[] }>('/api/v1/admin/postmortems'),
    request<{ data: AdminEventTemplate[] }>('/api/v1/admin/event-templates'),
    request<{ data: AdminRecurringMaintenancePlan[] }>('/api/v1/admin/recurring-maintenance-plans'),
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
    automationSuggestions: automationSuggestions.data,
    eventTemplates: eventTemplates.data,
    recurringMaintenancePlans: recurringMaintenancePlans.data,
    events,
  };
};

export const acceptAutomationSuggestion = (
  session: AdminSession,
  suggestion: AdminAutomationSuggestion
) =>
  request<{ data: { suggestion: AdminAutomationSuggestion; incident: AdminIncident } }>(
    `/api/v1/admin/automation/suggestions/${suggestion.id}/accept`,
    {
      method: 'POST',
      headers: { ...mutationHeaders(session), 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        expectedVersion: suggestion.version,
        ...(suggestion.nativeEventVersion
          ? { expectedNativeEventVersion: suggestion.nativeEventVersion }
          : {}),
      }),
    }
  );

export const ignoreAutomationSuggestion = (
  session: AdminSession,
  suggestion: AdminAutomationSuggestion
) =>
  request<{ data: AdminAutomationSuggestion }>(
    `/api/v1/admin/automation/suggestions/${suggestion.id}/ignore`,
    {
      method: 'POST',
      headers: mutationHeaders(session),
      body: JSON.stringify({ expectedVersion: suggestion.version }),
    }
  );

export const createIncident = (
  session: AdminSession,
  input: {
    pageId: string;
    title: string;
    body: string;
    affectedComponentIds: string[];
    template?: { id: string; version: number };
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

export const createEventTemplate = (
  session: AdminSession,
  input: {
    name: string;
    eventType: EventTemplateType;
    title: string;
    body: string;
    affectedComponentIds: string[];
    defaultNotifySubscribers: boolean;
    noticeKind: 'information' | 'warning' | null;
  }
) =>
  request<{ data: AdminEventTemplate }>('/api/v1/admin/event-templates', {
    method: 'POST',
    headers: { ...mutationHeaders(session), 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(input),
  });

export const updateEventTemplate = (
  session: AdminSession,
  templateId: string,
  input: {
    expectedVersion: number;
    state: EventTemplateState;
    name: string;
    eventType: EventTemplateType;
    title: string;
    body: string;
    affectedComponentIds: string[];
    defaultNotifySubscribers: boolean;
    noticeKind: 'information' | 'warning' | null;
  }
) =>
  request<{ data: AdminEventTemplate }>(`/api/v1/admin/event-templates/${templateId}/updates`, {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

interface RecurringMaintenanceMutationInput {
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
}

interface RecurringMaintenanceMutationResult {
  plan: AdminRecurringMaintenancePlan;
  materialization: AdminRecurringMaintenanceMaterialization;
}

export const createRecurringMaintenancePlan = (
  session: AdminSession,
  input: RecurringMaintenanceMutationInput
) =>
  request<{ data: RecurringMaintenanceMutationResult }>(
    '/api/v1/admin/recurring-maintenance-plans',
    {
      method: 'POST',
      headers: { ...mutationHeaders(session), 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(input),
    }
  );

export const updateRecurringMaintenancePlan = (
  session: AdminSession,
  planId: string,
  input: Omit<RecurringMaintenanceMutationInput, 'pageId'> & {
    expectedVersion: number;
    state: RecurringMaintenancePlanState;
  }
) =>
  request<{ data: RecurringMaintenanceMutationResult }>(
    `/api/v1/admin/recurring-maintenance-plans/${planId}/updates`,
    {
      method: 'POST',
      headers: mutationHeaders(session),
      body: JSON.stringify(input),
    }
  );

export const materializeRecurringMaintenancePlan = (
  session: AdminSession,
  plan: AdminRecurringMaintenancePlan
) =>
  request<{ data: AdminRecurringMaintenanceMaterialization }>(
    `/api/v1/admin/recurring-maintenance-plans/${plan.id}/materialize`,
    {
      method: 'POST',
      headers: mutationHeaders(session),
      body: JSON.stringify({ expectedVersion: plan.version }),
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

export const inspectTransitionFileSource = () =>
  request<{ data: { path: string; sha256: string; sizeBytes: number } }>(
    '/api/v1/admin/config/transitions/file-source'
  );

export const previewConfigModeTransition = (
  session: AdminSession,
  input: {
    from: 'managed' | 'file';
    to: 'managed' | 'file';
    expectedActiveRevision: number;
    source: AdminConfigTransitionSource;
  }
) =>
  request<{ data: AdminConfigTransitionPreview }>('/api/v1/admin/config/transitions/preview', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify({
      schemaVersion: '1.0',
      ...input,
      dryRun: true,
    }),
  });

export const applyConfigModeTransition = (
  session: AdminSession,
  input: {
    from: 'managed' | 'file';
    to: 'managed' | 'file';
    expectedActiveRevision: number;
    source: AdminConfigTransitionSource;
    previewToken: string;
  }
) =>
  request<{
    data: {
      transitionId: string;
      state: 'completed';
      mode: 'managed' | 'file';
      revision: number | null;
      contentHash: string;
      backupArtifactId: string;
      recovered: boolean;
    };
  }>('/api/v1/admin/config/transitions/apply', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify({
      schemaVersion: '1.0',
      ...input,
      dryRun: false,
    }),
  });

export const getBackupRetentionData = async () => {
  const [backups, retention] = await Promise.all([
    request<{ data: AdminBackupArtifact[] }>('/api/v1/admin/backups'),
    request<{ data: { policy: AdminRetentionPolicy; runs: AdminRetentionRun[] } }>(
      '/api/v1/admin/retention'
    ),
  ]);
  return {
    backups: backups.data,
    policy: retention.data.policy,
    runs: retention.data.runs,
  };
};

export const createBackup = (session: AdminSession) =>
  request<{ data: AdminBackupValidation }>('/api/v1/admin/backups', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: '{}',
  });

export const validateBackup = (session: AdminSession, backupId: string) =>
  request<{ data: AdminBackupValidation }>('/api/v1/admin/backups/restore/validate', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify({ backupId }),
  });

export const deleteEligibleBackup = (
  session: AdminSession,
  backupId: string,
  expectedManifestSha256: string
) =>
  request<{ data: { backupId: string; deletedAt: string } }>(
    `/api/v1/admin/backups/${encodeURIComponent(backupId)}`,
    {
      method: 'DELETE',
      headers: mutationHeaders(session),
      body: JSON.stringify({ expectedManifestSha256 }),
    }
  );

export const previewRetention = (session: AdminSession) =>
  request<{ data: AdminRetentionPreview }>('/api/v1/admin/retention/preview', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: '{}',
  });

export const runRetention = (session: AdminSession) =>
  request<{ data: AdminRetentionRun }>('/api/v1/admin/retention/run', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: '{}',
  });

export const updateRetentionPolicy = (
  session: AdminSession,
  expectedRevision: number,
  policy: AdminRetentionPolicy
) =>
  request<{ data: { revision: number; policy: AdminRetentionPolicy } }>(
    '/api/v1/admin/retention/policy',
    {
      method: 'PUT',
      headers: mutationHeaders(session),
      body: JSON.stringify({ expectedRevision, policy }),
    }
  );

export const getAdminAudit = (input: {
  limit?: number;
  cursor?: string;
  action?: string;
  result?: AdminAuditResult;
}) => {
  const query = new URLSearchParams();
  query.set('limit', String(input.limit ?? 50));
  if (input.cursor) query.set('cursor', input.cursor);
  if (input.action) query.set('action', input.action);
  if (input.result) query.set('result', input.result);
  return request<{ data: AdminAuditPage }>(`/api/v1/admin/audit?${query.toString()}`);
};

export const getAdminUsers = async () =>
  (await request<{ data: AdminUser[] }>('/api/v1/admin/users')).data;

export const createAdminUser = (
  session: AdminSession,
  input: {
    name: string;
    email: string;
    password: string;
    role: Exclude<AdminRole, 'owner'>;
  }
) =>
  request<{ data: AdminUser }>('/api/v1/admin/users', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

export const changeAdminUserRole = (
  session: AdminSession,
  userId: string,
  input: { expectedRole: AdminRole; role: AdminRole }
) =>
  request<{ data: { user: AdminUser; revokedSessions: number } }>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/role`,
    {
      method: 'PUT',
      headers: mutationHeaders(session),
      body: JSON.stringify(input),
    }
  );

export const getAdminUserSessions = async (userId: string) =>
  (
    await request<{ data: AdminUserSession[] }>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/sessions`
    )
  ).data;

export const revokeAdminUserSession = (session: AdminSession, userId: string, sessionId: string) =>
  request<{ data: { userId: string; sessionId: string; revoked: true } }>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'DELETE',
      headers: mutationHeaders(session),
      body: '{}',
    }
  );

export const getAdminOidcProvider = async () =>
  (await request<{ data: AdminOidcProvider }>('/api/v1/admin/security/oidc')).data;

export const configureAdminOidcProvider = (
  session: AdminSession,
  input: {
    expectedVersion: number;
    displayName: string;
    discoveryUrl: string;
    clientId: string;
    clientSecret?: string;
    tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post';
  }
) =>
  request<{ data: AdminOidcProvider }>('/api/v1/admin/security/oidc', {
    method: 'PUT',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

export const disableAdminOidcProvider = (session: AdminSession, expectedVersion: number) =>
  request<{ data: AdminOidcProvider }>('/api/v1/admin/security/oidc/disable', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify({ expectedVersion }),
  });

export const getAdminOidcMappings = async () =>
  (await request<{ data: AdminOidcMapping[] }>('/api/v1/admin/security/oidc/mappings')).data;

export const configureAdminOidcMapping = (
  session: AdminSession,
  userId: string,
  input: { expectedSubject: string | null; subject: string }
) =>
  request<{ data: AdminOidcMapping }>(
    `/api/v1/admin/security/oidc/mappings/${encodeURIComponent(userId)}`,
    {
      method: 'PUT',
      headers: mutationHeaders(session),
      body: JSON.stringify(input),
    }
  );

export const deleteAdminOidcMapping = (
  session: AdminSession,
  userId: string,
  expectedSubject: string
) =>
  request<{ data: { userId: string; removed: true; revokedSessions: number } }>(
    `/api/v1/admin/security/oidc/mappings/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: mutationHeaders(session),
      body: JSON.stringify({ expectedSubject }),
    }
  );

export const getAdminPasskeys = async () =>
  (await request<{ data: AdminPasskey[] }>('/api/v1/admin/security/passkeys')).data;

export const getAdminControlApiKeys = async () =>
  (await request<{ data: AdminControlApiKey[] }>('/api/v1/admin/security/control-api-keys')).data;

export const createAdminControlApiKey = (
  session: AdminSession,
  input: {
    name: string;
    access: AdminControlApiKey['access'];
    expiresIn: number | null;
  }
) =>
  request<{ data: CreatedAdminControlApiKey }>('/api/v1/admin/security/control-api-keys', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

export const deleteAdminControlApiKey = (
  session: AdminSession,
  keyId: string,
  expectedName: string | null
) =>
  request<{ data: { id: string; deleted: true } }>(
    `/api/v1/admin/security/control-api-keys/${encodeURIComponent(keyId)}`,
    {
      method: 'DELETE',
      headers: mutationHeaders(session),
      body: JSON.stringify({ expectedName }),
    }
  );

export const beginPasskeyRegistration = (
  session: AdminSession,
  input: {
    name: string;
    authenticatorAttachment?: 'platform' | 'cross-platform';
  }
) =>
  request<{
    data: { options: PublicKeyCredentialCreationOptionsJSON; name: string };
  }>('/api/v1/admin/security/passkeys/register/options', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

export const completePasskeyRegistration = (
  session: AdminSession,
  input: {
    name: string;
    response: Omit<RegistrationResponseJSON, 'clientExtensionResults'>;
  }
) =>
  request<{ data: AdminPasskey }>('/api/v1/admin/security/passkeys/register/verify', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

export const renameAdminPasskey = (
  session: AdminSession,
  passkeyId: string,
  input: { expectedName: string | null; name: string }
) =>
  request<{ data: AdminPasskey }>(
    `/api/v1/admin/security/passkeys/${encodeURIComponent(passkeyId)}`,
    {
      method: 'PUT',
      headers: mutationHeaders(session),
      body: JSON.stringify(input),
    }
  );

export const getAdminTwoFactorStatus = async () =>
  (await request<{ data: AdminTwoFactorStatus }>('/api/v1/admin/security/two-factor')).data;

export const beginAdminTwoFactorSetup = (session: AdminSession, password: string) =>
  request<{ data: { totpURI: string; backupCodes: string[] } }>(
    '/api/v1/admin/security/two-factor/setup',
    {
      method: 'POST',
      headers: mutationHeaders(session),
      body: JSON.stringify({ password }),
    }
  );

export const verifyAdminTwoFactorSetup = (session: AdminSession, input: { code: string }) =>
  request<{ data: AdminTwoFactorStatus }>('/api/v1/admin/security/two-factor/setup/verify', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify(input),
  });

export const regenerateAdminRecoveryCodes = (session: AdminSession, password: string) =>
  request<{ data: { backupCodes: string[] } }>('/api/v1/admin/security/two-factor/recovery-codes', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify({ password }),
  });

export const disableAdminTwoFactor = (session: AdminSession, password: string) =>
  request<{ data: AdminTwoFactorStatus }>('/api/v1/admin/security/two-factor/disable', {
    method: 'POST',
    headers: mutationHeaders(session),
    body: JSON.stringify({ password }),
  });

export const deleteAdminPasskey = (
  session: AdminSession,
  passkeyId: string,
  expectedName: string | null
) =>
  request<{ data: { passkeyId: string; deleted: true } }>(
    `/api/v1/admin/security/passkeys/${encodeURIComponent(passkeyId)}`,
    {
      method: 'DELETE',
      headers: mutationHeaders(session),
      body: JSON.stringify({ expectedName }),
    }
  );

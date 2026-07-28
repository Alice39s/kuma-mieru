import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  HttpMethod,
  MonitorState,
  type HttpMonitor,
  type HttpMonitorDraft,
} from './gen/kuma/mieru/control/v1/control_pb.js';

export type ControlProviderKind = 'uptime-robot-v3' | 'better-stack-uptime-v2';

export interface ProviderRuntime {
  id: string;
  kind: ControlProviderKind;
  token: string;
}

interface Page<T> {
  items: T[];
  nextPageToken?: string;
}

const requestJson = async (
  provider: ProviderRuntime,
  path: string,
  init: RequestInit = {}
): Promise<unknown> => {
  const base =
    provider.kind === 'uptime-robot-v3'
      ? 'https://api.uptimerobot.com/v3/'
      : 'https://uptime.betterstack.com/api/v2/';
  const mutating = init.method !== undefined && init.method !== 'GET';
  let response: Response;
  try {
    response = await fetch(new URL(path, base), {
      ...init,
      redirect: 'error',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${provider.token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    throw Object.assign(new Error('Provider request did not return a response'), {
      code: mutating ? 'provider_outcome_unknown' : 'provider_request_failed',
      outcomeUnknown: mutating,
      cause,
    });
  }
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after');
    throw Object.assign(new Error(`Provider request failed with HTTP ${response.status}`), {
      code: response.status === 429 ? 'provider_rate_limited' : 'provider_request_failed',
      outcomeUnknown: false,
      retryAfter,
    });
  }
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch (cause) {
    throw Object.assign(new Error('Provider returned an invalid JSON response'), {
      code: 'provider_response_invalid',
      outcomeUnknown: mutating,
      cause,
    });
  }
};

const uptimeRobotMonitorSchema = z
  .object({
    id: z.number().int(),
    friendlyName: z.string(),
    url: z.string(),
    status: z.string().optional(),
    type: z.string(),
    interval: z.number().int().optional(),
    timeout: z.number().int().optional(),
    httpMethodType: z.string().optional(),
    followRedirections: z.boolean().optional(),
  })
  .passthrough();

const uptimeRobotPageSchema = z.object({
  data: z.array(uptimeRobotMonitorSchema),
  nextLink: z.string().nullable(),
});

const betterStackMonitorSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    attributes: z
      .object({
        pronounceable_name: z.string().nullable().optional(),
        url: z.string().nullable().optional(),
        monitor_type: z.string().optional(),
        check_frequency: z.number().int().optional(),
        request_timeout: z.number().int().optional(),
        http_method: z.string().optional(),
        follow_redirects: z.boolean().optional(),
        paused_at: z.string().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const betterStackPageSchema = z.object({
  data: z.array(betterStackMonitorSchema),
  pagination: z
    .object({
      next: z.string().nullable().optional(),
    })
    .passthrough()
    .optional(),
});

type UptimeRobotMonitor = z.infer<typeof uptimeRobotMonitorSchema>;
type BetterStackMonitor = z.infer<typeof betterStackMonitorSchema>;

const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const normalizeUptimeRobot = (providerId: string, value: UptimeRobotMonitor): HttpMonitor => ({
  $typeName: 'kuma.mieru.control.v1.HttpMonitor',
  providerId,
  externalId: String(value.id),
  displayName: value.friendlyName,
  url: value.url,
  method: value.httpMethodType?.toUpperCase() === 'GET' ? HttpMethod.GET : HttpMethod.HEAD,
  intervalSeconds: value.interval ?? 60,
  timeoutSeconds: value.timeout ?? 30,
  followRedirects: value.followRedirections ?? true,
  state:
    value.status?.toUpperCase() === 'PAUSED'
      ? MonitorState.PAUSED
      : value.status
        ? MonitorState.ACTIVE
        : MonitorState.UNKNOWN,
  fingerprint: fingerprint(value),
  writeSupported: value.type.toUpperCase() === 'HTTP',
});

const normalizeBetterStack = (providerId: string, value: BetterStackMonitor): HttpMonitor => ({
  $typeName: 'kuma.mieru.control.v1.HttpMonitor',
  providerId,
  externalId: value.id,
  displayName: value.attributes.pronounceable_name ?? value.id,
  url: value.attributes.url ?? '',
  method: value.attributes.http_method?.toUpperCase() === 'HEAD' ? HttpMethod.HEAD : HttpMethod.GET,
  intervalSeconds: value.attributes.check_frequency ?? 60,
  timeoutSeconds: value.attributes.request_timeout ?? 15,
  followRedirects: value.attributes.follow_redirects ?? true,
  state: value.attributes.paused_at ? MonitorState.PAUSED : MonitorState.ACTIVE,
  fingerprint: fingerprint(value),
  writeSupported: value.attributes.monitor_type === 'status',
});

const normalizeMutationResponse = (provider: ProviderRuntime, payload: unknown): HttpMonitor => {
  if (provider.kind === 'uptime-robot-v3') {
    return normalizeUptimeRobot(provider.id, uptimeRobotMonitorSchema.parse(payload));
  }
  return normalizeBetterStack(
    provider.id,
    z.object({ data: betterStackMonitorSchema }).parse(payload).data
  );
};

export const validateHttpMonitorDraft = (draft: HttpMonitorDraft) => {
  if (!draft.displayName.trim() || draft.displayName.length > 250) {
    throw Object.assign(new Error('Monitor display name is invalid'), { code: 'invalid_argument' });
  }
  const url = new URL(draft.url);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw Object.assign(new Error('Monitor URL must be credential-free HTTPS'), {
      code: 'invalid_argument',
    });
  }
  if (draft.method !== HttpMethod.GET && draft.method !== HttpMethod.HEAD) {
    throw Object.assign(new Error('Only GET and HEAD monitors are writable'), {
      code: 'invalid_argument',
    });
  }
  if (draft.intervalSeconds < 30 || draft.intervalSeconds > 86_400) {
    throw Object.assign(new Error('Monitor interval must be between 30 and 86400 seconds'), {
      code: 'invalid_argument',
    });
  }
  if (![2, 3, 5, 10, 15, 30, 45, 60].includes(draft.timeoutSeconds)) {
    throw Object.assign(new Error('Monitor timeout is not portable across providers'), {
      code: 'invalid_argument',
    });
  }
  if (draft.timeoutSeconds > draft.intervalSeconds) {
    throw Object.assign(new Error('Monitor timeout cannot exceed its interval'), {
      code: 'invalid_argument',
    });
  }
};

export const testProvider = async (provider: ProviderRuntime) => {
  await listMonitors(provider, 1);
  return { readVerified: true, accountLabel: provider.kind };
};

export const listMonitors = async (
  provider: ProviderRuntime,
  pageSize = 100,
  pageToken?: string
): Promise<Page<HttpMonitor>> => {
  const size = Math.min(Math.max(pageSize || 100, 1), 200);
  if (provider.kind === 'uptime-robot-v3') {
    const query = new URLSearchParams({ limit: String(size) });
    if (pageToken) query.set('cursor', pageToken);
    const page = uptimeRobotPageSchema.parse(await requestJson(provider, `monitors?${query}`));
    const next = page.nextLink
      ? new URL(page.nextLink, 'https://api.uptimerobot.com/v3/').searchParams.get('cursor')
      : null;
    return {
      items: page.data.map(value => normalizeUptimeRobot(provider.id, value)),
      ...(next ? { nextPageToken: next } : {}),
    };
  }
  const query = new URLSearchParams({ per_page: String(size) });
  if (pageToken) query.set('page', pageToken);
  const page = betterStackPageSchema.parse(await requestJson(provider, `monitors?${query}`));
  const next = page.pagination?.next;
  const nextPage = next
    ? new URL(next, 'https://uptime.betterstack.com/api/v2/').searchParams.get('page')
    : null;
  return {
    items: page.data.map(value => normalizeBetterStack(provider.id, value)),
    ...(nextPage ? { nextPageToken: nextPage } : {}),
  };
};

export const getMonitor = async (provider: ProviderRuntime, externalId: string) => {
  const payload = await requestJson(provider, `monitors/${encodeURIComponent(externalId)}`);
  if (provider.kind === 'uptime-robot-v3') {
    return normalizeUptimeRobot(provider.id, uptimeRobotMonitorSchema.parse(payload));
  }
  const wrapper = z.object({ data: betterStackMonitorSchema }).parse(payload);
  return normalizeBetterStack(provider.id, wrapper.data);
};

export const createHttpMonitor = async (provider: ProviderRuntime, draft: HttpMonitorDraft) => {
  validateHttpMonitorDraft(draft);
  const body =
    provider.kind === 'uptime-robot-v3'
      ? {
          friendlyName: draft.displayName,
          type: 'HTTP',
          url: draft.url,
          httpMethodType: draft.method === HttpMethod.HEAD ? 'HEAD' : 'GET',
          interval: draft.intervalSeconds,
          timeout: draft.timeoutSeconds,
          followRedirections: draft.followRedirects,
          successHttpResponseCodes: ['2xx'],
          assignedAlertContacts: [],
        }
      : {
          pronounceable_name: draft.displayName,
          monitor_type: 'status',
          url: draft.url,
          http_method: draft.method === HttpMethod.HEAD ? 'head' : 'get',
          check_frequency: draft.intervalSeconds,
          request_timeout: draft.timeoutSeconds,
          follow_redirects: draft.followRedirects,
          email: false,
          sms: false,
          call: false,
          push: false,
        };
  const payload = await requestJson(provider, 'monitors', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return normalizeMutationResponse(provider, payload);
};

export const updateHttpMonitor = async (
  provider: ProviderRuntime,
  externalId: string,
  draft: HttpMonitorDraft,
  fields: string[]
) => {
  validateHttpMonitorDraft(draft);
  const common: Record<string, unknown> = {};
  const includes = (field: string) => fields.length === 0 || fields.includes(field);
  if (provider.kind === 'uptime-robot-v3') {
    if (includes('display_name')) common.friendlyName = draft.displayName;
    if (includes('url')) common.url = draft.url;
    if (includes('method'))
      common.httpMethodType = draft.method === HttpMethod.HEAD ? 'HEAD' : 'GET';
    if (includes('interval_seconds')) common.interval = draft.intervalSeconds;
    if (includes('timeout_seconds')) common.timeout = draft.timeoutSeconds;
    if (includes('follow_redirects')) common.followRedirections = draft.followRedirects;
  } else {
    if (includes('display_name')) common.pronounceable_name = draft.displayName;
    if (includes('url')) common.url = draft.url;
    if (includes('method')) common.http_method = draft.method === HttpMethod.HEAD ? 'head' : 'get';
    if (includes('interval_seconds')) common.check_frequency = draft.intervalSeconds;
    if (includes('timeout_seconds')) common.request_timeout = draft.timeoutSeconds;
    if (includes('follow_redirects')) common.follow_redirects = draft.followRedirects;
  }
  const payload = await requestJson(provider, `monitors/${encodeURIComponent(externalId)}`, {
    method: 'PATCH',
    body: JSON.stringify(common),
  });
  return normalizeMutationResponse(provider, payload);
};

export const setMonitorPaused = async (
  provider: ProviderRuntime,
  externalId: string,
  paused: boolean
) => {
  if (provider.kind === 'uptime-robot-v3') {
    const payload = await requestJson(
      provider,
      `monitors/${encodeURIComponent(externalId)}/${paused ? 'pause' : 'start'}`,
      { method: 'POST', body: '{}' }
    );
    return normalizeMutationResponse(provider, payload);
  }
  const payload = await requestJson(provider, `monitors/${encodeURIComponent(externalId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ paused }),
  });
  return normalizeMutationResponse(provider, payload);
};

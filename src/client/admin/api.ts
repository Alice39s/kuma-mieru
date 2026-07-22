export interface AdminSession {
  userId: string;
  role: 'owner' | 'publisher' | 'editor' | 'viewer';
  csrfToken: string;
}

export interface AdminSource {
  id: string;
  kind: 'uptime-kuma';
  baseUrl: string;
  pageIds: string[];
}

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

export interface AdminMeta {
  version: string;
  schemaVersion: number;
  config: {
    mode: 'managed' | 'file' | 'compatibility';
    revision: number | null;
    contentHash: string;
    loadedAt: string;
  };
}

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
  const [meta, sources, pages, revisions] = await Promise.all([
    request<AdminMeta>('/api/v1/meta'),
    request<{ data: AdminSource[] }>('/api/v1/admin/sources'),
    request<{ data: AdminPage[] }>('/api/v1/admin/pages'),
    request<{ data: AdminRevision[] }>('/api/v1/admin/config/revisions'),
  ]);
  return { meta, sources: sources.data, pages: pages.data, revisions: revisions.data };
};

export const testSource = (session: AdminSession, source: AdminSource) =>
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

export const createSource = (
  session: AdminSession,
  input: { expectedRevision: number; source: AdminSource; testToken: string }
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

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

export interface AdminApiOptions {
  empty?: boolean;
  role?: AdminRole;
  setupRequired?: boolean;
}

export interface AdminApiState {
  authenticated: boolean;
  mutationHeaders: Array<{ csrf: string | null; origin: string | null }>;
  ownerSetup: { email: string; name: string; password: string; token: string } | null;
  pages: AdminPage[];
  revision: number;
  role: AdminRole;
  sources: AdminSource[];
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
    mutationHeaders: [],
    ownerSetup: null,
    pages: options.empty ? [] : [{ ...referencePage }],
    revision: options.empty ? 1 : 7,
    role: options.role ?? 'owner',
    sources: options.empty ? [] : [{ ...referenceSource }],
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

    if (
      [
        '/api/v1/admin/events',
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

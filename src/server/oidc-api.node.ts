import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import type { HttpJsonRequest, HttpJsonResponse } from './adapters/http-client.js';
import { createApp } from './app.js';
import { createAuth } from './auth/auth.js';
import { createBootstrapService } from './auth/bootstrap.js';
import { createOidcControlPlane } from './auth/oidc.js';
import { createManagedRevision } from './config/repository.js';
import type { RuntimeConfigSnapshot } from './config/runtime-config.js';
import { openDatabase } from './db/database.js';
import { migrateDatabase } from './db/migrator.js';
import { createSecretStore } from './secrets/store.js';

const baseURL = 'http://127.0.0.1:3882';
const password = 'a-secure-owner-password';
const discoveryUrl = 'https://id.example.com/.well-known/openid-configuration';
const issuer = 'https://id.example.com/';

const browserJsonHeaders = {
  'Content-Type': 'application/json',
  Origin: baseURL,
  'Sec-Fetch-Site': 'same-origin',
  'X-Forwarded-For': '8.8.4.4',
};

const response = (data: unknown): HttpJsonResponse => ({
  status: 200,
  data,
  etag: null,
  lastModified: null,
});

const createCookieJar = () => {
  const cookies = new Map<string, string>();
  return {
    apply(source: Response) {
      for (const value of source.headers.getSetCookie()) {
        const pair = value.split(';', 1)[0];
        if (!pair) continue;
        const separator = pair.indexOf('=');
        if (separator < 1) continue;
        const name = pair.slice(0, separator);
        const removed = /(?:^|;)\s*max-age=0(?:;|$)/iu.test(value);
        if (removed) cookies.delete(name);
        else cookies.set(name, pair.slice(separator + 1));
      }
    },
    header() {
      return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    },
  };
};

test('keeps Generic OIDC behind explicit local mappings and a narrow login gateway', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-oidc-api-'));
  const databasePath = resolve(directory, 'test.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    const migration = await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const revision = createManagedRevision(
      database,
      {
        schemaVersion: 1,
        server: { publicBaseUrl: 'https://status.example.com' },
        sources: [],
        pages: [],
      },
      'system:test'
    );
    const snapshot: RuntimeConfigSnapshot = {
      mode: 'managed',
      revision: revision.revision,
      contentHash: revision.contentHash,
      loadedAt: new Date().toISOString(),
      config: revision.config,
    };
    const secret = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH';
    const secretStore = createSecretStore(database, {
      currentKeyId: 'test-key',
      keys: new Map([['test-key', Buffer.alloc(32, 23)]]),
    });
    let currentSubject = 'viewer-subject';
    const requests: Array<{ url: string; request?: HttpJsonRequest }> = [];
    const requestJson = async (url: URL, request?: HttpJsonRequest): Promise<HttpJsonResponse> => {
      requests.push({ url: url.toString(), request });
      if (url.toString() === discoveryUrl) {
        return response({
          issuer,
          authorization_endpoint: 'https://id.example.com/authorize',
          token_endpoint: 'https://id.example.com/token',
          userinfo_endpoint: 'https://id.example.com/userinfo',
          response_types_supported: ['code'],
          scopes_supported: ['openid'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        });
      }
      if (url.toString() === 'https://id.example.com/token') {
        assert.equal(request?.method, 'POST');
        assert.match(request?.body ?? '', /grant_type=authorization_code/u);
        assert.match(request?.body ?? '', /code_verifier=/u);
        return response({
          access_token: 'callback-only-access-token',
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'openid',
        });
      }
      if (url.toString() === 'https://id.example.com/userinfo') {
        assert.equal(request?.headers?.Authorization, 'Bearer callback-only-access-token');
        return response({ sub: currentSubject, role: 'owner', email: 'untrusted@example.net' });
      }
      throw new Error(`Unexpected OIDC URL: ${url}`);
    };
    const oidc = createOidcControlPlane({ database, secretStore, requestJson });
    let auth = createAuth({
      database,
      baseURL,
      secret,
      trustedOrigins: [baseURL],
      oidc: null,
    });
    const refreshAuth = () => {
      auth = createAuth({
        database,
        baseURL,
        secret,
        trustedOrigins: [baseURL],
        oidc: oidc.getRuntimeConfig(),
      });
    };
    const bootstrap = createBootstrapService({
      database,
      auth,
      providedToken: 'setup-token-with-more-than-thirty-two-characters',
    });
    bootstrap.initialize();
    await bootstrap.complete(
      {
        token: 'setup-token-with-more-than-thirty-two-characters',
        email: 'owner@example.com',
        name: 'Owner',
        password,
      },
      'bootstrap-request'
    );
    database
      .prepare(
        `INSERT INTO "user"
          (id, name, email, emailVerified, image, createdAt, updatedAt, role)
         VALUES ('viewer-1', 'OIDC Viewer', 'viewer@example.com', 1, NULL, ?, ?, 'viewer')`
      )
      .run('2026-07-25T00:00:00.000Z', '2026-07-25T00:00:00.000Z');

    const app = createApp({
      snapshot,
      schemaVersion: migration.currentVersion,
      buildVersion: '2.0.0-test',
      database,
      auth,
      getAuth: () => auth,
      authSecret: secret,
      oidc,
      onAuthConfigurationChanged: refreshAuth,
      trustedOrigins: [baseURL],
      bootstrap,
      secretStore,
    });
    const request = (path: string, init?: RequestInit) => app.request(new URL(path, baseURL), init);

    const initialMethods = await request('/api/v1/auth/methods');
    assert.deepEqual(await initialMethods.json(), {
      data: { passkey: true, password: true, oidc: null },
    });
    const unavailableStart = await request('/api/v1/auth/oidc', {
      method: 'POST',
      headers: browserJsonHeaders,
      body: '{}',
    });
    assert.equal(unavailableStart.status, 503);

    const ownerJar = createCookieJar();
    const ownerSignIn = await request('/api/v1/auth/sign-in', {
      method: 'POST',
      headers: browserJsonHeaders,
      body: JSON.stringify({ email: 'owner@example.com', password }),
    });
    assert.equal(ownerSignIn.status, 200);
    ownerJar.apply(ownerSignIn);
    const ownerSession = await request('/api/v1/admin/session', {
      headers: { Cookie: ownerJar.header() },
    });
    const ownerSessionBody = (await ownerSession.json()) as {
      data: { csrfToken: string };
    };
    const ownerHeaders = {
      ...browserJsonHeaders,
      Cookie: ownerJar.header(),
      'X-Kuma-CSRF': ownerSessionBody.data.csrfToken,
    };

    const rejectedConfiguration = await request('/api/v1/admin/security/oidc', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseURL,
        Cookie: ownerJar.header(),
        'X-Kuma-CSRF': ownerSessionBody.data.csrfToken,
      },
      body: '{}',
    });
    assert.equal(rejectedConfiguration.status, 403);

    const configuration = await request('/api/v1/admin/security/oidc', {
      method: 'PUT',
      headers: ownerHeaders,
      body: JSON.stringify({
        expectedVersion: 0,
        displayName: 'Company SSO',
        discoveryUrl,
        clientId: 'kuma-client',
        clientSecret: 'oidc-client-secret',
        tokenEndpointAuthMethod: 'client_secret_basic',
      }),
    });
    assert.equal(configuration.status, 200);
    const configurationBody = await configuration.json();
    assert.doesNotMatch(
      JSON.stringify(configurationBody),
      /oidc-client-secret|secretRef|token_url|userinfo_endpoint/u
    );
    const mapping = await request('/api/v1/admin/security/oidc/mappings/viewer-1', {
      method: 'PUT',
      headers: ownerHeaders,
      body: JSON.stringify({ expectedSubject: null, subject: 'viewer-subject' }),
    });
    assert.equal(mapping.status, 200);
    const mappingBody = await mapping.json();
    assert.match(JSON.stringify(mappingBody), /viewer-subject/u);
    assert.doesNotMatch(JSON.stringify(mappingBody), /accessToken|refreshToken|idToken/u);

    const methods = await request('/api/v1/auth/methods');
    assert.deepEqual(await methods.json(), {
      data: {
        passkey: true,
        password: true,
        oidc: { providerId: 'kuma-oidc', displayName: 'Company SSO' },
      },
    });
    for (const path of ['/api/auth/sign-in/oauth2', '/api/auth/oauth2/link']) {
      const raw = await request(path, {
        method: 'POST',
        headers: browserJsonHeaders,
        body: '{}',
      });
      assert.equal(raw.status, 404);
    }
    const untrustedStart = await request('/api/v1/auth/oidc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseURL },
      body: '{}',
    });
    assert.equal(untrustedStart.status, 403);

    const oidcJar = createCookieJar();
    const start = await app.request(new URL('/api/v1/auth/oidc', 'http://attacker.invalid'), {
      method: 'POST',
      headers: browserJsonHeaders,
      body: '{}',
    });
    assert.equal(start.status, 200);
    oidcJar.apply(start);
    const startBody = (await start.json()) as { data: { url: string } };
    const authorizationUrl = new URL(startBody.data.url);
    assert.equal(authorizationUrl.origin, 'https://id.example.com');
    assert.equal(authorizationUrl.pathname, '/authorize');
    assert.equal(authorizationUrl.searchParams.get('client_id'), 'kuma-client');
    assert.equal(authorizationUrl.searchParams.get('scope'), 'openid');
    assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(authorizationUrl.searchParams.get('code_challenge'));
    const state = authorizationUrl.searchParams.get('state');
    assert.ok(state);
    assert.equal(
      authorizationUrl.searchParams.get('redirect_uri'),
      `${baseURL}/api/auth/oauth2/callback/kuma-oidc`
    );
    assert.doesNotMatch(startBody.data.url, /oidc-client-secret|requestSignUp/u);

    const callback = await request(
      `/api/auth/oauth2/callback/kuma-oidc?code=valid-code&state=${encodeURIComponent(state)}&iss=${encodeURIComponent(issuer)}`,
      { headers: { Cookie: oidcJar.header() } }
    );
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), `${baseURL}/admin`);
    oidcJar.apply(callback);
    const viewerSession = await request('/api/v1/admin/session', {
      headers: { Cookie: oidcJar.header() },
    });
    assert.equal(viewerSession.status, 200);
    const viewerSessionBody = (await viewerSession.json()) as {
      data: { userId: string; role: string };
    };
    assert.deepEqual(
      { userId: viewerSessionBody.data.userId, role: viewerSessionBody.data.role },
      { userId: 'viewer-1', role: 'viewer' }
    );
    assert.deepEqual(
      database.prepare(`SELECT name, email, role FROM "user" WHERE id = 'viewer-1'`).get(),
      {
        name: 'OIDC Viewer',
        email: 'viewer@example.com',
        role: 'viewer',
      }
    );
    const storedAccount = database
      .prepare(
        `SELECT accessToken, refreshToken, idToken
         FROM "account" WHERE providerId = 'kuma-oidc' AND accountId = 'viewer-subject'`
      )
      .get();
    assert.deepEqual(storedAccount, {
      accessToken: null,
      refreshToken: null,
      idToken: null,
    });
    assert.equal(
      (database.prepare(`SELECT COUNT(*) AS count FROM "user"`).get() as { count: number }).count,
      2
    );

    currentSubject = 'unmapped-subject';
    const unknownJar = createCookieJar();
    const unknownStart = await request('/api/v1/auth/oidc', {
      method: 'POST',
      headers: browserJsonHeaders,
      body: '{}',
    });
    unknownJar.apply(unknownStart);
    const unknownUrl = new URL(((await unknownStart.json()) as { data: { url: string } }).data.url);
    const unknownState = unknownUrl.searchParams.get('state');
    assert.ok(unknownState);
    const unknownCallback = await request(
      `/api/auth/oauth2/callback/kuma-oidc?code=unknown-code&state=${encodeURIComponent(unknownState)}&iss=${encodeURIComponent(issuer)}`,
      { headers: { Cookie: unknownJar.header() } }
    );
    assert.equal(unknownCallback.status, 302);
    assert.match(unknownCallback.headers.get('location') ?? '', /authError=oidc/u);
    assert.equal(
      (database.prepare(`SELECT COUNT(*) AS count FROM "user"`).get() as { count: number }).count,
      2
    );

    const viewerConfiguration = await request('/api/v1/admin/security/oidc', {
      headers: { Cookie: oidcJar.header() },
    });
    assert.equal(viewerConfiguration.status, 403);
    const disabled = await request('/api/v1/admin/security/oidc/disable', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    assert.equal(disabled.status, 200);
    const disabledMethods = await request('/api/v1/auth/methods');
    assert.deepEqual(await disabledMethods.json(), {
      data: { passkey: true, password: true, oidc: null },
    });
    const disabledCallback = await request(
      '/api/auth/oauth2/callback/kuma-oidc?code=ignored&state=ignored'
    );
    assert.equal(disabledCallback.status, 404);
    assert.equal(
      requests.some(entry => entry.url === 'https://id.example.com/token'),
      true
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

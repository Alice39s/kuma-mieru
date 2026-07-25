import assert from 'node:assert/strict';
import test from 'node:test';
import type { HttpJsonRequest, HttpJsonResponse } from '../adapters/http-client.js';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { createSecretStore } from '../secrets/store.js';
import { createOidcControlPlane, oidcErrorCode } from './oidc.js';

const discoveryUrl = 'https://id.example.com/.well-known/openid-configuration';
const issuer = 'https://id.example.com/';
const clientId = 'kuma:client +';
const clientSecret = 'client:secret +plaintext';
const expectedBasicCredentials = 'kuma%3Aclient+%2B:client%3Asecret+%2Bplaintext';
const audit = {
  actorId: 'owner-1',
  requestId: 'request-oidc',
  ipAddress: '203.0.113.10',
  userAgent: 'private-test-agent',
};

const response = (data: unknown): HttpJsonResponse => ({
  status: 200,
  data,
  etag: null,
  lastModified: null,
});

test('stores one generic OIDC provider and explicit local subject mappings without token retention', async () => {
  const { database } = openDatabase(':memory:');
  try {
    await migrateDatabase(database, { directory: 'migrations', databasePath: ':memory:' });
    const insertUser = database.prepare(
      `INSERT INTO "user"
        (id, name, email, emailVerified, image, createdAt, updatedAt, role)
       VALUES (?, ?, ?, 1, NULL, ?, ?, ?)`
    );
    insertUser.run(
      'owner-1',
      'Local Owner',
      'owner@example.com',
      '2026-07-25T00:00:00.000Z',
      '2026-07-25T00:00:00.000Z',
      'owner'
    );
    insertUser.run(
      'viewer-1',
      'Local Viewer',
      'viewer@example.com',
      '2026-07-25T00:00:00.000Z',
      '2026-07-25T00:00:00.000Z',
      'viewer'
    );
    database
      .prepare(
        `INSERT INTO "session"
          (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
         VALUES ('owner-session', ?, 'owner-token', ?, ?, NULL, NULL, 'owner-1')`
      )
      .run('2026-07-26T00:00:00.000Z', '2026-07-25T00:00:00.000Z', '2026-07-25T00:00:00.000Z');
    const secretStore = createSecretStore(database, {
      currentKeyId: 'test-key',
      keys: new Map([['test-key', Buffer.alloc(32, 19)]]),
    });
    const requests: Array<{ url: string; request?: HttpJsonRequest }> = [];
    let foreignTokenEndpoint = false;
    let tokenType = 'Bearer';
    const requestJson = async (url: URL, request?: HttpJsonRequest): Promise<HttpJsonResponse> => {
      requests.push({ url: url.toString(), request });
      if (url.toString() === discoveryUrl) {
        return response({
          issuer,
          authorization_endpoint: 'https://id.example.com/authorize',
          token_endpoint: foreignTokenEndpoint
            ? 'https://attacker.example/token'
            : 'https://id.example.com/token',
          userinfo_endpoint: 'https://id.example.com/userinfo',
          response_types_supported: ['code'],
          scopes_supported: ['openid'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        });
      }
      if (url.toString() === 'https://id.example.com/token') {
        return response({
          access_token: 'temporary-access-token',
          token_type: tokenType,
          expires_in: 300,
          scope: 'openid',
        });
      }
      if (url.toString() === 'https://id.example.com/userinfo') {
        return response({
          sub: 'subject-owner',
          email: 'provider-controlled@example.net',
          role: 'super-admin',
        });
      }
      throw new Error(`Unexpected OIDC URL: ${url}`);
    };
    const oidc = createOidcControlPlane({ database, secretStore, requestJson });

    assert.deepEqual(oidc.getProvider(), {
      enabled: false,
      configured: false,
      displayName: null,
      discoveryUrl: null,
      issuer: null,
      clientId: null,
      clientSecretConfigured: false,
      tokenEndpointAuthMethod: null,
      version: 0,
    });
    const configured = await oidc.configure(
      {
        expectedVersion: 0,
        displayName: 'Example Identity',
        discoveryUrl,
        clientId,
        clientSecret,
        tokenEndpointAuthMethod: 'client_secret_basic',
      },
      audit
    );
    assert.equal(configured.enabled, true);
    assert.equal(configured.version, 1);
    assert.equal(configured.clientSecretConfigured, true);
    assert.deepEqual(oidc.getPublicProvider(), {
      providerId: 'kuma-oidc',
      displayName: 'Example Identity',
    });
    assert.equal(
      oidc.isAuthorizationUrlAllowed('https://id.example.com/authorize?client_id=safe'),
      true
    );
    assert.equal(
      oidc.isAuthorizationUrlAllowed('https://id.example.com/authorize/other?client_id=safe'),
      false
    );
    assert.doesNotMatch(
      JSON.stringify({ configured, publicProvider: oidc.getPublicProvider() }),
      /client:secret \+plaintext|secretRef|token_url|userinfo/u
    );
    const encrypted = database
      .prepare(
        `SELECT ciphertext FROM encrypted_secrets
         WHERE resource_id = 'auth:oidc:kuma-oidc' AND field_name = 'client-secret'`
      )
      .get() as { ciphertext: Buffer };
    assert.equal(encrypted.ciphertext.includes(Buffer.from(clientSecret)), false);

    const concurrentUpdates = await Promise.allSettled([
      oidc.configure(
        {
          expectedVersion: 1,
          displayName: 'First concurrent update',
          discoveryUrl,
          clientId,
          tokenEndpointAuthMethod: 'client_secret_basic',
        },
        audit
      ),
      oidc.configure(
        {
          expectedVersion: 1,
          displayName: 'Second concurrent update',
          discoveryUrl,
          clientId,
          tokenEndpointAuthMethod: 'client_secret_basic',
        },
        audit
      ),
    ]);
    assert.equal(concurrentUpdates.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(
      concurrentUpdates.filter(
        result =>
          result.status === 'rejected' && oidcErrorCode(result.reason) === 'oidc_version_conflict'
      ).length,
      1
    );
    assert.equal(oidc.getProvider().version, 2);

    const mapping = oidc.configureMapping(
      'owner-1',
      { expectedSubject: null, subject: 'subject-owner' },
      audit
    );
    assert.equal(mapping.role, 'owner');
    assert.equal(mapping.subject, 'subject-owner');
    assert.equal(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM "session" WHERE userId = 'owner-1'`)
          .get() as { count: number }
      ).count,
      0
    );
    assert.throws(
      () =>
        oidc.configureMapping(
          'viewer-1',
          { expectedSubject: null, subject: 'subject-owner' },
          audit
        ),
      error => oidcErrorCode(error) === 'oidc_subject_conflict'
    );

    const runtime = oidc.getRuntimeConfig();
    assert.ok(runtime);
    await assert.rejects(
      () =>
        runtime.getToken({
          code: 'authorization-code',
          redirectURI: 'https://status.example.com/api/auth/oauth2/callback/kuma-oidc',
        }),
      error => oidcErrorCode(error) === 'oidc_pkce_verifier_missing'
    );
    const tokens = await runtime.getToken({
      code: 'authorization-code',
      redirectURI: 'https://status.example.com/api/auth/oauth2/callback/kuma-oidc',
      codeVerifier: 'pkce-verifier',
    });
    assert.equal(tokens.accessToken, 'temporary-access-token');
    const tokenRequest = requests.find(entry => entry.url === 'https://id.example.com/token');
    assert.equal(tokenRequest?.request?.method, 'POST');
    assert.equal(
      tokenRequest?.request?.headers?.Authorization,
      `Basic ${Buffer.from(expectedBasicCredentials, 'utf8').toString('base64')}`
    );
    assert.doesNotMatch(tokenRequest?.request?.body ?? '', /client:secret \+plaintext/u);
    tokenType = 'DPoP';
    await assert.rejects(
      () =>
        runtime.getToken({
          code: 'unsupported-token-code',
          redirectURI: 'https://status.example.com/api/auth/oauth2/callback/kuma-oidc',
          codeVerifier: 'pkce-verifier',
        }),
      error => oidcErrorCode(error) === 'oidc_token_type_unsupported'
    );
    tokenType = 'Bearer';
    const mappedUser = await runtime.getUserInfo(tokens);
    assert.deepEqual(mappedUser, {
      id: 'subject-owner',
      name: 'Local Owner',
      email: 'owner@example.com',
      emailVerified: true,
    });
    assert.equal(tokens.accessToken, undefined);
    const userInfoRequest = requests.find(entry => entry.url === 'https://id.example.com/userinfo');
    assert.equal(userInfoRequest?.request?.headers?.Authorization, 'Bearer temporary-access-token');

    const account = database
      .prepare(
        `SELECT accessToken, refreshToken, idToken, providerId, accountId, userId
         FROM "account" WHERE providerId = 'kuma-oidc'`
      )
      .get();
    assert.deepEqual(account, {
      accessToken: null,
      refreshToken: null,
      idToken: null,
      providerId: 'kuma-oidc',
      accountId: 'subject-owner',
      userId: 'owner-1',
    });
    const auditPayload = JSON.stringify(
      database
        .prepare(
          `SELECT before_json, after_json FROM admin_audit
           WHERE target_type = 'oidc' ORDER BY occurred_at`
        )
        .all()
    );
    assert.doesNotMatch(
      auditPayload,
      /client:secret \+plaintext|temporary-access-token|subject-owner|provider-controlled/u
    );

    foreignTokenEndpoint = true;
    await assert.rejects(
      () =>
        oidc.configure(
          {
            expectedVersion: 2,
            displayName: 'Rejected Provider',
            discoveryUrl,
            clientId,
            tokenEndpointAuthMethod: 'client_secret_basic',
          },
          audit
        ),
      error => oidcErrorCode(error) === 'oidc_endpoint_origin_mismatch'
    );
    assert.equal(oidc.getProvider().version, 2);
    foreignTokenEndpoint = false;

    database
      .prepare(
        `INSERT INTO "session"
          (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
         VALUES ('owner-session-2', ?, 'owner-token-2', ?, ?, NULL, NULL, 'owner-1')`
      )
      .run('2026-07-26T00:00:00.000Z', '2026-07-25T00:00:00.000Z', '2026-07-25T00:00:00.000Z');
    const disabled = oidc.disable({ expectedVersion: 2 }, audit);
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.version, 3);
    assert.equal(oidc.getRuntimeConfig(), null);
    assert.equal(oidc.getPublicProvider(), null);
    assert.equal(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM "session" WHERE userId = 'owner-1'`)
          .get() as { count: number }
      ).count,
      0
    );
  } finally {
    database.close();
  }
});

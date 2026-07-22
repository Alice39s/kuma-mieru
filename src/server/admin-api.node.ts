import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { createApp } from './app.js';
import { createAuth } from './auth/auth.js';
import { createBootstrapService } from './auth/bootstrap.js';
import { createManagedRevision, type ConfigRevision } from './config/repository.js';
import type { RuntimeConfigSnapshot } from './config/runtime-config.js';
import { openDatabase } from './db/database.js';
import { migrateDatabase } from './db/migrator.js';
import { createSecretStore } from './secrets/store.js';
import { createPiiProtector } from './subscriptions/crypto.js';

test('requires a Better Auth session, trusted origin and bound CSRF token for config writes', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-admin-api-'));
  const databasePath = resolve(directory, 'test.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    const migration = await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const initial = createManagedRevision(
      database,
      {
        schemaVersion: 1,
        server: {},
        sources: [
          {
            id: 'primary',
            kind: 'uptime-kuma',
            baseUrl: 'https://status.example.com',
            pageIds: ['main'],
          },
        ],
        pages: [],
      },
      'system:bootstrap'
    );
    let runtime: RuntimeConfigSnapshot = {
      mode: 'managed',
      revision: initial.revision,
      contentHash: initial.contentHash,
      loadedAt: new Date().toISOString(),
      config: initial.config,
    };
    const baseURL = 'http://127.0.0.1:3882';
    const secret = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH';
    const auth = createAuth({ database, baseURL, secret });
    const secretStore = createSecretStore(database, {
      currentKeyId: 'test-key',
      keys: new Map([['test-key', Buffer.alloc(32, 11)]]),
    });
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
        password: 'a-secure-owner-password',
      },
      'bootstrap-request'
    );
    const apply = (revision: ConfigRevision) => {
      runtime = {
        mode: 'managed',
        revision: revision.revision,
        contentHash: revision.contentHash,
        loadedAt: new Date().toISOString(),
        config: revision.config,
      };
    };
    const app = createApp({
      snapshot: runtime,
      getRuntimeSnapshot: () => runtime,
      schemaVersion: migration.currentVersion,
      buildVersion: '2.0.0-test',
      database,
      auth,
      authSecret: secret,
      trustedOrigins: [baseURL],
      secretStore,
      onManagedRevision: apply,
    });

    const unauthenticated = await app.request('/api/v1/admin/pages');
    assert.equal(unauthenticated.status, 401);

    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseURL },
      body: JSON.stringify({ email: 'owner@example.com', password: 'a-secure-owner-password' }),
    });
    assert.equal(signIn.status, 200);
    const setCookie = signIn.headers.get('set-cookie');
    assert.ok(setCookie);
    const cookie = setCookie.split(';')[0];

    const session = await app.request('/api/v1/admin/session', { headers: { Cookie: cookie } });
    assert.equal(session.status, 200);
    const sessionBody = (await session.json()) as { data: { csrfToken: string } };
    assert.ok(sessionBody.data.csrfToken);

    const storedSecret = await app.request('/api/v1/admin/secrets/source-token', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: baseURL,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
        'X-Kuma-CSRF': sessionBody.data.csrfToken,
      },
      body: JSON.stringify({ resourceId: 'robot', value: 'read-only-uptimerobot-token' }),
    });
    const storedSecretBody = (await storedSecret.json()) as {
      data: { secretRef: string; resourceId: string; keyId: string };
      error?: { code: string; message: string };
    };
    assert.equal(storedSecret.status, 201, JSON.stringify(storedSecretBody));
    assert.match(storedSecretBody.data.secretRef, /^sec_/u);
    assert.equal(storedSecretBody.data.resourceId, 'robot');
    assert.equal(JSON.stringify(storedSecretBody).includes('read-only-uptimerobot-token'), false);
    assert.equal(
      secretStore.resolve(storedSecretBody.data.secretRef, {
        resourceId: 'robot',
        fieldName: 'apiToken',
        purpose: 'source-token',
      }),
      'read-only-uptimerobot-token'
    );

    const existingSourceSecret = await app.request('/api/v1/admin/secrets/source-token', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: baseURL,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
        'X-Kuma-CSRF': sessionBody.data.csrfToken,
      },
      body: JSON.stringify({ resourceId: 'primary', value: 'must-not-be-written' }),
    });
    assert.equal(existingSourceSecret.status, 409);
    assert.equal(
      secretStore.list().some(item => item.resourceId === 'primary'),
      false
    );

    const pageBody = JSON.stringify({
      expectedRevision: initial.revision,
      page: { id: 'public', slug: 'main', title: 'Status', sourceRefs: ['primary'] },
    });
    const missingOrigin = await app.request('/api/v1/admin/pages', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Kuma-CSRF': sessionBody.data.csrfToken,
      },
      body: pageBody,
    });
    assert.equal(missingOrigin.status, 403);

    const created = await app.request('/api/v1/admin/pages', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        Origin: baseURL,
        'Sec-Fetch-Site': 'same-origin',
        'X-Kuma-CSRF': sessionBody.data.csrfToken,
      },
      body: pageBody,
    });
    assert.equal(created.status, 201);
    assert.equal(runtime.revision, initial.revision + 1);
    assert.equal(runtime.config.pages[0]?.id, 'public');

    const conflict = await app.request('/api/v1/admin/pages', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        Origin: baseURL,
        'Sec-Fetch-Site': 'same-origin',
        'X-Kuma-CSRF': sessionBody.data.csrfToken,
      },
      body: pageBody,
    });
    assert.equal(conflict.status, 409);

    const mutationHeaders = {
      Cookie: cookie,
      'Content-Type': 'application/json',
      Origin: baseURL,
      'Sec-Fetch-Site': 'same-origin',
      'X-Kuma-CSRF': sessionBody.data.csrfToken,
    };
    const nonceResponse = await app.request('/api/v1/public/pages/main/subscriptions/email/nonce');
    assert.equal(nonceResponse.status, 200);
    const nonce = (await nonceResponse.json()) as { data: { nonce: string } };
    const subscribe = await app.request('/api/v1/public/pages/main/subscriptions/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'subscriber@example.com',
        componentIds: [],
        nonce: nonce.data.nonce,
      }),
    });
    assert.equal(subscribe.status, 202);
    const subscribeBody = await subscribe.json();
    const invalidSubscribe = await app.request('/api/v1/public/pages/main/subscriptions/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'another@example.com',
        componentIds: [],
        nonce: 'invalid-subscription-nonce',
      }),
    });
    assert.equal(invalidSubscribe.status, 202);
    assert.deepEqual(await invalidSubscribe.json(), subscribeBody);
    const honeypotSubscribe = await app.request('/api/v1/public/pages/main/subscriptions/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bot@example.com',
        componentIds: [],
        nonce: nonce.data.nonce,
        website: 'https://spam.example.com',
      }),
    });
    assert.equal(honeypotSubscribe.status, 202);
    assert.deepEqual(await honeypotSubscribe.json(), subscribeBody);
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM email_subscriptions').get() as {
          count: number;
        }
      ).count,
      1
    );
    const protector = createPiiProtector(secret);
    const confirmation = database
      .prepare(
        `SELECT payload_ciphertext FROM notification_outbox
         WHERE kind = 'subscription_confirmation'`
      )
      .get() as { payload_ciphertext: string };
    const confirmationPayload = JSON.parse(protector.decrypt(confirmation.payload_ciphertext)) as {
      confirmToken: string;
      unsubscribeToken: string;
    };
    const confirmationPreview = await app.request(
      `/api/v1/public/subscriptions/confirm/${confirmationPayload.confirmToken}`
    );
    assert.equal(confirmationPreview.status, 200);
    assert.equal(confirmationPreview.headers.get('cache-control'), 'no-store');
    const confirmed = await app.request(
      `/api/v1/public/subscriptions/confirm/${confirmationPayload.confirmToken}`,
      { method: 'POST' }
    );
    assert.equal(confirmed.status, 200);

    const incidentCreated = await app.request('/api/v1/admin/incidents', {
      method: 'POST',
      headers: { ...mutationHeaders, 'Idempotency-Key': 'incident-create-admin-api-0001' },
      body: JSON.stringify({
        pageId: 'public',
        title: 'API latency elevated',
        body: 'We are investigating elevated latency.',
        affectedComponentIds: ['primary'],
      }),
    });
    assert.equal(incidentCreated.status, 201);
    const incident = (await incidentCreated.json()) as { data: { id: string; version: number } };
    assert.equal(incident.data.version, 1);

    const reviewResponse = await app.request(`/api/v1/admin/incidents/${incident.data.id}/review`, {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ expectedVersion: 1, notifySubscribers: true }),
    });
    assert.equal(reviewResponse.status, 200);
    const review = (await reviewResponse.json()) as { data: { reviewNonce: string } };
    const invalidPublish = await app.request(
      `/api/v1/admin/incidents/${incident.data.id}/publish`,
      {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({
          expectedVersion: 1,
          notifySubscribers: false,
          reviewNonce: review.data.reviewNonce,
        }),
      }
    );
    assert.equal(invalidPublish.status, 409);
    const published = await app.request(`/api/v1/admin/incidents/${incident.data.id}/publish`, {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({
        expectedVersion: 1,
        notifySubscribers: true,
        reviewNonce: review.data.reviewNonce,
      }),
    });
    assert.equal(published.status, 201);
    const publicIncidents = await app.request('/api/v1/public/pages/main/incidents');
    assert.equal(publicIncidents.status, 200);
    const publicIncidentBody = (await publicIncidents.json()) as { data: unknown[] };
    assert.equal(publicIncidentBody.data.length, 1);
    const rss = await app.request('/status/main/rss.xml');
    assert.equal(rss.status, 200);
    assert.equal(rss.headers.get('content-type'), 'application/rss+xml; charset=utf-8');
    assert.equal((await rss.text()).includes('API latency elevated'), true);
    const etag = rss.headers.get('etag');
    assert.ok(etag);
    const unchangedRss = await app.request('/status/main/rss.xml', {
      headers: { 'If-None-Match': etag },
    });
    assert.equal(unchangedRss.status, 304);
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM notification_outbox
             WHERE kind = 'event_publication' AND state = 'queued'`
          )
          .get() as { count: number }
      ).count,
      1
    );
    const unsubscribed = await app.request(
      `/api/v1/public/subscriptions/unsubscribe/${confirmationPayload.unsubscribeToken}`,
      { method: 'POST' }
    );
    assert.equal(unsubscribed.status, 200);
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM notification_outbox
             WHERE kind = 'event_publication' AND state = 'failed'
               AND last_error_code = 'SUBSCRIPTION_UNSUBSCRIBED'`
          )
          .get() as { count: number }
      ).count,
      1
    );

    const signedOut = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: baseURL },
    });
    assert.equal(signedOut.status, 200);
    const sessionAfterSignOut = await app.request('/api/v1/admin/session', {
      headers: { Cookie: cookie },
    });
    assert.equal(sessionAfterSignOut.status, 401);

    const attempts = database
      .prepare(
        `SELECT result, error_code FROM admin_audit
         WHERE result IN ('denied', 'failed') ORDER BY occurred_at ASC`
      )
      .all() as Array<{ result: string; error_code: string }>;
    assert.deepEqual(attempts, [
      { result: 'failed', error_code: 'SOURCE_ALREADY_EXISTS' },
      { result: 'denied', error_code: 'UNTRUSTED_ORIGIN' },
      { result: 'failed', error_code: 'CONFIG_REVISION_CONFLICT' },
      { result: 'failed', error_code: 'PUBLICATION_REVIEW_INVALID' },
    ]);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

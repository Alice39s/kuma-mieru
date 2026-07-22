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
    let fileReloads = 0;
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
      getFileReloadStatus: () => ({
        state: 'failed',
        lastAttemptAt: '2026-07-23T00:01:00.000Z',
        lastSuccessAt: '2026-07-23T00:00:00.000Z',
        lastErrorCode: 'config_invalid',
        failedHash: 'a'.repeat(64),
      }),
      reloadFileConfig: async () => {
        fileReloads += 1;
        return {
          outcome: 'unchanged',
          status: {
            state: 'ready',
            lastAttemptAt: new Date().toISOString(),
            lastSuccessAt: runtime.loadedAt,
            lastErrorCode: null,
            failedHash: null,
          },
        };
      },
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

    const incidentResolved = await app.request(
      `/api/v1/admin/incidents/${incident.data.id}/updates`,
      {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({
          expectedVersion: 1,
          state: 'resolved',
          body: 'Service has been restored.',
          affectedComponentIds: ['primary'],
        }),
      }
    );
    assert.equal(incidentResolved.status, 200);
    const postmortemCreated = await app.request('/api/v1/admin/postmortems', {
      method: 'POST',
      headers: { ...mutationHeaders, 'Idempotency-Key': 'postmortem-create-admin-api-0001' },
      body: JSON.stringify({
        incidentId: incident.data.id,
        title: 'API latency review',
        body: 'Root cause and corrective actions.',
      }),
    });
    const postmortem = (await postmortemCreated.json()) as {
      data: { id: string; version: number };
    };
    assert.equal(postmortemCreated.status, 201);
    const postmortemReviewed = await app.request(
      `/api/v1/admin/postmortems/${postmortem.data.id}/updates`,
      {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({
          expectedVersion: 1,
          state: 'reviewed',
          body: 'Corrective actions have been reviewed.',
        }),
      }
    );
    assert.equal(postmortemReviewed.status, 200);
    const postmortemReady = await app.request(
      `/api/v1/admin/postmortems/${postmortem.data.id}/updates`,
      {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({
          expectedVersion: 2,
          state: 'published',
          body: 'Corrective actions are approved for publication.',
        }),
      }
    );
    assert.equal(postmortemReady.status, 200);
    const postmortemReviewResponse = await app.request(
      `/api/v1/admin/postmortems/${postmortem.data.id}/review`,
      {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({ expectedVersion: 3, notifySubscribers: false }),
      }
    );
    const postmortemReview = (await postmortemReviewResponse.json()) as {
      data: { reviewNonce: string };
    };
    assert.equal(postmortemReviewResponse.status, 200);
    const postmortemPublished = await app.request(
      `/api/v1/admin/postmortems/${postmortem.data.id}/publish`,
      {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({
          expectedVersion: 3,
          notifySubscribers: false,
          reviewNonce: postmortemReview.data.reviewNonce,
        }),
      }
    );
    assert.equal(postmortemPublished.status, 201);
    const publicPostmortems = await app.request(
      `/api/v1/public/pages/main/incidents/${incident.data.id}/postmortems`
    );
    const publicPostmortemsBody = (await publicPostmortems.json()) as { data: unknown[] };
    assert.equal(publicPostmortems.status, 200);
    assert.equal(publicPostmortemsBody.data.length, 1);

    const maintenanceCreated = await app.request('/api/v1/admin/maintenances', {
      method: 'POST',
      headers: { ...mutationHeaders, 'Idempotency-Key': 'maintenance-create-admin-api-0001' },
      body: JSON.stringify({
        pageId: 'public',
        title: 'Database maintenance',
        body: 'We will apply a database upgrade.',
        affectedComponentIds: ['primary'],
        scheduledStartAt: '2026-07-24T01:00:00.000Z',
        scheduledEndAt: '2026-07-24T02:00:00.000Z',
      }),
    });
    assert.equal(maintenanceCreated.status, 201);
    const maintenance = (await maintenanceCreated.json()) as {
      data: { id: string; version: number };
    };
    const maintenanceUpdated = await app.request(
      `/api/v1/admin/maintenances/${maintenance.data.id}/updates`,
      {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({
          expectedVersion: maintenance.data.version,
          state: 'scheduled',
          body: 'The maintenance window is confirmed.',
        }),
      }
    );
    assert.equal(maintenanceUpdated.status, 200);
    const maintenanceReviewResponse = await app.request(
      `/api/v1/admin/maintenances/${maintenance.data.id}/review`,
      {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({ expectedVersion: 2, notifySubscribers: false }),
      }
    );
    assert.equal(maintenanceReviewResponse.status, 200);
    const maintenanceReview = (await maintenanceReviewResponse.json()) as {
      data: { reviewNonce: string };
    };
    const maintenancePublished = await app.request(
      `/api/v1/admin/maintenances/${maintenance.data.id}/publish`,
      {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({
          expectedVersion: 2,
          notifySubscribers: false,
          reviewNonce: maintenanceReview.data.reviewNonce,
        }),
      }
    );
    assert.equal(maintenancePublished.status, 201);
    const publicMaintenance = await app.request('/api/v1/public/pages/main/maintenance');
    const publicMaintenanceBody = (await publicMaintenance.json()) as { data: unknown[] };
    assert.equal(publicMaintenance.status, 200);
    assert.equal(publicMaintenanceBody.data.length, 1);

    const noticeCreated = await app.request('/api/v1/admin/notices', {
      method: 'POST',
      headers: { ...mutationHeaders, 'Idempotency-Key': 'notice-create-admin-api-0001' },
      body: JSON.stringify({
        pageId: 'public',
        title: 'Support hours update',
        body: 'Support hours will change next week.',
        kind: 'information',
        affectedComponentIds: [],
      }),
    });
    const notice = (await noticeCreated.json()) as { data: { id: string; version: number } };
    assert.equal(noticeCreated.status, 201);
    const noticeUpdated = await app.request(`/api/v1/admin/notices/${notice.data.id}/updates`, {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({
        expectedVersion: notice.data.version,
        state: 'published',
        body: 'Support hours will change next week.',
      }),
    });
    assert.equal(noticeUpdated.status, 200);
    const noticeReviewResponse = await app.request(
      `/api/v1/admin/notices/${notice.data.id}/review`,
      {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({ expectedVersion: 2, notifySubscribers: false }),
      }
    );
    const noticeReview = (await noticeReviewResponse.json()) as {
      data: { reviewNonce: string };
    };
    assert.equal(noticeReviewResponse.status, 200);
    const noticePublished = await app.request(`/api/v1/admin/notices/${notice.data.id}/publish`, {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({
        expectedVersion: 2,
        notifySubscribers: false,
        reviewNonce: noticeReview.data.reviewNonce,
      }),
    });
    assert.equal(noticePublished.status, 201);
    const publicNotices = await app.request('/api/v1/public/pages/main/notices');
    const publicNoticesBody = (await publicNotices.json()) as { data: unknown[] };
    assert.equal(publicNotices.status, 200);
    assert.equal(publicNoticesBody.data.length, 1);

    const rss = await app.request('/status/main/rss.xml');
    assert.equal(rss.status, 200);
    assert.equal(rss.headers.get('content-type'), 'application/rss+xml; charset=utf-8');
    const rssBody = await rss.text();
    assert.equal(rssBody.includes('API latency elevated'), true);
    assert.equal(rssBody.includes('Database maintenance'), true);
    assert.equal(rssBody.includes('Support hours update'), true);
    assert.equal(rssBody.includes('API latency review'), true);
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

    const deliveryAdminNow = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO email_subscriptions
          (id, page_id, incident_id, scope_key, component_ids_json, email_hash,
           email_ciphertext, state, created_at, confirmed_at, updated_at)
         VALUES ('admin-subscriber', 'public', NULL, 'components:primary', '["primary"]',
                 ?, 'admin-encrypted-address', 'active', ?, ?, ?)`
      )
      .run('b'.repeat(64), deliveryAdminNow, deliveryAdminNow, deliveryAdminNow);
    database
      .prepare(
        `INSERT INTO notification_outbox
          (id, publication_id, subscription_id, channel, kind, idempotency_key, state,
           attempts, next_attempt_at, payload_ciphertext, last_error_code, created_at)
         VALUES ('admin-delivery', NULL, 'admin-subscriber', 'email', 'event_publication',
                 'admin-delivery-idempotency', 'dead_letter', 8, ?,
                 'admin-encrypted-payload', 'SMTP_550', ?)`
      )
      .run(deliveryAdminNow, deliveryAdminNow);
    const subscribersResponse = await app.request('/api/v1/admin/subscribers', {
      headers: { Cookie: cookie },
    });
    const subscribersBody = (await subscribersResponse.json()) as { data: unknown[] };
    assert.equal(subscribersResponse.status, 200);
    assert.equal(subscribersBody.data.length >= 2, true);
    assert.equal(JSON.stringify(subscribersBody).includes('admin-encrypted-address'), false);
    const deliveriesResponse = await app.request('/api/v1/admin/deliveries', {
      headers: { Cookie: cookie },
    });
    const deliveriesBody = (await deliveriesResponse.json()) as { data: unknown[] };
    assert.equal(deliveriesResponse.status, 200);
    assert.equal(JSON.stringify(deliveriesBody).includes('admin-encrypted-payload'), false);
    const retriedDelivery = await app.request('/api/v1/admin/deliveries/admin-delivery/retry', {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ expectedState: 'dead_letter' }),
    });
    assert.equal(retriedDelivery.status, 200);
    const suppressedSubscriber = await app.request(
      '/api/v1/admin/subscribers/admin-subscriber/suppress',
      {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({ expectedState: 'active' }),
      }
    );
    assert.equal(suppressedSubscriber.status, 200);
    assert.deepEqual(
      database
        .prepare(
          `SELECT o.state AS delivery_state, o.last_error_code, s.state AS subscriber_state
           FROM notification_outbox o
           JOIN email_subscriptions s ON s.id = o.subscription_id
           WHERE o.id = 'admin-delivery'`
        )
        .get(),
      {
        delivery_state: 'dead_letter',
        last_error_code: 'ADMIN_SUPPRESSED',
        subscriber_state: 'suppressed',
      }
    );

    const reloadOutsideFileMode = await app.request('/api/v1/admin/config/reload', {
      method: 'POST',
      headers: mutationHeaders,
      body: '{}',
    });
    assert.equal(reloadOutsideFileMode.status, 409);
    const managedRuntime = runtime;
    runtime = { ...runtime, mode: 'file', revision: null };
    const publicMeta = await app.request('/api/v1/meta');
    const publicMetaBody = (await publicMeta.json()) as { config: { reload: unknown } };
    assert.equal(JSON.stringify(publicMetaBody.config.reload).includes('failedHash'), false);
    const adminConfigStatus = await app.request('/api/v1/admin/config/status', {
      headers: { Cookie: cookie },
    });
    const adminConfigStatusBody = (await adminConfigStatus.json()) as {
      data: { reload: { failedHash: string } };
    };
    assert.equal(adminConfigStatusBody.data.reload.failedHash, 'a'.repeat(64));
    const fileReload = await app.request('/api/v1/admin/config/reload', {
      method: 'POST',
      headers: mutationHeaders,
      body: '{}',
    });
    assert.equal(fileReload.status, 200);
    assert.equal(fileReloads, 1);
    runtime = managedRuntime;

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

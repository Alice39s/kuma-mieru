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
    const attempts = database
      .prepare(
        `SELECT result, error_code FROM admin_audit
         WHERE result IN ('denied', 'failed') ORDER BY occurred_at ASC`
      )
      .all() as Array<{ result: string; error_code: string }>;
    assert.deepEqual(attempts, [
      { result: 'denied', error_code: 'UNTRUSTED_ORIGIN' },
      { result: 'failed', error_code: 'CONFIG_REVISION_CONFLICT' },
    ]);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

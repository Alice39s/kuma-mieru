import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { base32 } from '@better-auth/utils/base32';
import { createApp } from './app.js';
import { createAuth } from './auth/auth.js';
import { createBootstrapService } from './auth/bootstrap.js';
import { createManagedRevision } from './config/repository.js';
import type { RuntimeConfigSnapshot } from './config/runtime-config.js';
import { openDatabase } from './db/database.js';
import { migrateDatabase } from './db/migrator.js';

const baseURL = 'http://127.0.0.1:3882';
const password = 'a-secure-owner-password';

const browserJsonHeaders = {
  'Content-Type': 'application/json',
  Origin: baseURL,
  'Sec-Fetch-Site': 'same-origin',
  'X-Forwarded-For': '8.8.8.8',
};

const createCookieJar = () => {
  const cookies = new Map<string, string>();
  return {
    apply(response: Response) {
      for (const value of response.headers.getSetCookie()) {
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
    clear() {
      cookies.clear();
    },
  };
};

test('keeps TOTP setup, challenge and one-time recovery codes behind narrow app APIs', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-two-factor-'));
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
    const auth = createAuth({ database, baseURL, secret, trustedOrigins: [baseURL] });
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
    const app = createApp({
      snapshot,
      schemaVersion: migration.currentVersion,
      buildVersion: '2.0.0-test',
      database,
      auth,
      authSecret: secret,
      trustedOrigins: [baseURL],
      bootstrap,
    });
    const jar = createCookieJar();

    const rawSignIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: browserJsonHeaders,
      body: JSON.stringify({ email: 'owner@example.com', password }),
    });
    assert.equal(rawSignIn.status, 404);

    const untrustedSignIn = await app.request('/api/v1/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseURL },
      body: JSON.stringify({ email: 'owner@example.com', password }),
    });
    assert.equal(untrustedSignIn.status, 403);

    const rawPasskeyOptions = await app.request('/api/auth/passkey/generate-authenticate-options');
    assert.equal(rawPasskeyOptions.status, 404);
    const passkeyOptions = await app.request('/api/v1/auth/passkey/options', {
      method: 'POST',
      headers: browserJsonHeaders,
      body: '{}',
    });
    assert.equal(passkeyOptions.status, 200);
    const passkeyOptionsBody = (await passkeyOptions.json()) as {
      data: { challenge: string };
    };
    assert.ok(passkeyOptionsBody.data.challenge);
    assert.doesNotMatch(
      JSON.stringify(passkeyOptionsBody),
      /credentialID|publicKey|counter|token|email|userId/u
    );
    assert.ok(passkeyOptions.headers.get('set-cookie'));

    const signIn = await app.request('/api/v1/auth/sign-in', {
      method: 'POST',
      headers: browserJsonHeaders,
      body: JSON.stringify({ email: 'owner@example.com', password }),
    });
    assert.equal(signIn.status, 200);
    jar.apply(signIn);
    const signInBody = await signIn.json();
    assert.deepEqual(signInBody, { data: { state: 'authenticated' } });
    assert.doesNotMatch(JSON.stringify(signInBody), /token|password|user/u);

    const session = await app.request('/api/v1/admin/session', {
      headers: { Cookie: jar.header() },
    });
    const sessionBody = (await session.json()) as {
      data: { userId: string; csrfToken: string };
    };
    assert.equal(session.status, 200);
    const adminHeaders = () => ({
      ...browserJsonHeaders,
      Cookie: jar.header(),
      'X-Kuma-CSRF': sessionBody.data.csrfToken,
    });

    const initialStatus = await app.request('/api/v1/admin/security/two-factor', {
      headers: { Cookie: jar.header() },
    });
    assert.equal(initialStatus.status, 200);
    assert.deepEqual(await initialStatus.json(), {
      data: {
        enabled: false,
        setupPending: false,
        recoveryCodesConfigured: false,
      },
    });

    const setup = await app.request('/api/v1/admin/security/two-factor/setup', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ password }),
    });
    assert.equal(setup.status, 200);
    const setupBody = (await setup.json()) as {
      data: { totpURI: string; backupCodes: string[] };
    };
    assert.match(setupBody.data.totpURI, /^otpauth:\/\/totp\//u);
    assert.equal(setupBody.data.backupCodes.length, 10);
    assert.doesNotMatch(
      JSON.stringify(setupBody),
      /encrypted|lockedUntil|failedVerification|user/u
    );

    const setupURI = new URL(setupBody.data.totpURI);
    const provisioningSecret = setupURI.searchParams.get('secret');
    assert.ok(provisioningSecret);
    const plainSecret = new TextDecoder().decode(base32.decode(provisioningSecret));
    const stored = database
      .prepare(
        `SELECT secret, backupCodes, verified, failedVerificationCount, lockedUntil
         FROM "twoFactor" WHERE "userId" = ?`
      )
      .get(sessionBody.data.userId) as {
      secret: string;
      backupCodes: string;
      verified: number;
      failedVerificationCount: number;
      lockedUntil: string | null;
    };
    assert.equal(stored.verified, 0);
    assert.equal(stored.failedVerificationCount, 0);
    assert.equal(stored.lockedUntil, null);
    assert.notEqual(stored.secret, plainSecret);
    assert.equal(stored.secret.includes(plainSecret), false);
    for (const code of setupBody.data.backupCodes) {
      assert.equal(stored.backupCodes.includes(code), false);
    }
    const pendingUser = database
      .prepare(`SELECT "twoFactorEnabled" FROM "user" WHERE id = ?`)
      .get(sessionBody.data.userId) as { twoFactorEnabled: number };
    assert.equal(pendingUser.twoFactorEnabled, 0);

    const wrongSetupCode = await app.request('/api/v1/admin/security/two-factor/setup/verify', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ code: '000000' }),
    });
    assert.equal(wrongSetupCode.status, 409);
    assert.equal(
      (
        database
          .prepare(`SELECT "twoFactorEnabled" FROM "user" WHERE id = ?`)
          .get(sessionBody.data.userId) as { twoFactorEnabled: number }
      ).twoFactorEnabled,
      0
    );

    const generated = await auth.api.generateTOTP({ body: { secret: plainSecret } });
    const preRotationCookie = jar.header();
    const verifiedSetup = await app.request('/api/v1/admin/security/two-factor/setup/verify', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ code: generated.code }),
    });
    const verifiedSetupBody = await verifiedSetup.clone().json();
    assert.equal(verifiedSetup.status, 200, JSON.stringify(verifiedSetupBody));
    assert.doesNotMatch(JSON.stringify(verifiedSetupBody), /token|secret|backup/u);
    jar.apply(verifiedSetup);

    const staleSession = await app.request('/api/v1/admin/session', {
      headers: { Cookie: preRotationCookie },
    });
    assert.equal(staleSession.status, 401);
    const rotatedSession = await app.request('/api/v1/admin/session', {
      headers: { Cookie: jar.header() },
    });
    assert.equal(rotatedSession.status, 200);
    const rotatedBody = (await rotatedSession.json()) as {
      data: { csrfToken: string };
    };
    assert.notEqual(rotatedBody.data.csrfToken, sessionBody.data.csrfToken);

    const enabledStatus = await app.request('/api/v1/admin/security/two-factor', {
      headers: { Cookie: jar.header() },
    });
    assert.deepEqual(await enabledStatus.json(), {
      data: { enabled: true, setupPending: false, recoveryCodesConfigured: true },
    });
    for (const path of [
      '/api/auth/two-factor/enable',
      '/api/auth/two-factor/disable',
      '/api/auth/two-factor/generate-backup-codes',
      '/api/auth/two-factor/get-totp-uri',
      '/api/auth/two-factor/verify-totp',
      '/api/auth/two-factor/verify-backup-code',
    ]) {
      const disabled = await app.request(path, {
        method: 'POST',
        headers: { ...browserJsonHeaders, Cookie: jar.header() },
        body: '{}',
      });
      assert.equal(disabled.status, 404);
    }

    const signOut = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: { ...browserJsonHeaders, Cookie: jar.header() },
    });
    assert.equal(signOut.status, 200);
    jar.apply(signOut);
    jar.clear();

    const beginChallenge = async () => {
      const response = await app.request('/api/v1/auth/sign-in', {
        method: 'POST',
        headers: browserJsonHeaders,
        body: JSON.stringify({ email: 'owner@example.com', password }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body, {
        data: { state: 'two_factor_required', methods: ['totp', 'backup_code'] },
      });
      assert.doesNotMatch(JSON.stringify(body), /token|email|user/u);
      jar.apply(response);
      assert.equal(
        (
          database.prepare(`SELECT COUNT(*) AS count FROM "session"`).get() as {
            count: number;
          }
        ).count,
        0
      );
    };

    await beginChallenge();
    const invalidChallenge = await app.request('/api/v1/auth/two-factor/totp', {
      method: 'POST',
      headers: { ...browserJsonHeaders, Cookie: jar.header() },
      body: JSON.stringify({ code: '000000', trustDevice: false }),
    });
    assert.equal(invalidChallenge.status, 401);
    assert.equal(
      (
        database
          .prepare(`SELECT failedVerificationCount FROM "twoFactor" WHERE "userId" = ?`)
          .get(sessionBody.data.userId) as { failedVerificationCount: number }
      ).failedVerificationCount,
      1
    );

    const firstRecoveryCode = setupBody.data.backupCodes[0];
    assert.ok(firstRecoveryCode);
    const recovered = await app.request('/api/v1/auth/two-factor/backup-code', {
      method: 'POST',
      headers: { ...browserJsonHeaders, Cookie: jar.header() },
      body: JSON.stringify({ code: firstRecoveryCode, trustDevice: false }),
    });
    assert.equal(recovered.status, 200);
    assert.deepEqual(await recovered.clone().json(), { data: { state: 'authenticated' } });
    assert.doesNotMatch(JSON.stringify(await recovered.json()), /token|user|email/u);
    jar.apply(recovered);

    const recoveredSignOut = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: { ...browserJsonHeaders, Cookie: jar.header() },
    });
    assert.equal(recoveredSignOut.status, 200);
    jar.clear();
    await beginChallenge();
    const reusedRecoveryCode = await app.request('/api/v1/auth/two-factor/backup-code', {
      method: 'POST',
      headers: { ...browserJsonHeaders, Cookie: jar.header() },
      body: JSON.stringify({ code: firstRecoveryCode, trustDevice: false }),
    });
    assert.equal(reusedRecoveryCode.status, 401);

    const thirdRecoveryAttempt = await app.request('/api/v1/auth/two-factor/backup-code', {
      method: 'POST',
      headers: { ...browserJsonHeaders, Cookie: jar.header() },
      body: JSON.stringify({ code: firstRecoveryCode, trustDevice: false }),
    });
    assert.equal(thirdRecoveryAttempt.status, 401);
    const rateLimitedChallenge = await app.request('/api/v1/auth/two-factor/backup-code', {
      method: 'POST',
      headers: { ...browserJsonHeaders, Cookie: jar.header() },
      body: JSON.stringify({ code: firstRecoveryCode, trustDevice: false }),
    });
    assert.equal(rateLimitedChallenge.status, 429);
    const rateLimitedBody = await rateLimitedChallenge.clone().json();
    assert.deepEqual(rateLimitedBody, {
      error: {
        code: 'AUTHENTICATION_RATE_LIMITED',
        message: 'Try again later',
        requestId: (rateLimitedBody as { error: { requestId: string } }).error.requestId,
      },
    });
    assert.ok(
      rateLimitedChallenge.headers.get('retry-after'),
      JSON.stringify([...rateLimitedChallenge.headers])
    );

    const currentCode = await auth.api.generateTOTP({ body: { secret: plainSecret } });
    database
      .prepare(
        `UPDATE "twoFactor"
         SET failedVerificationCount = 10, lockedUntil = ?
         WHERE "userId" = ?`
      )
      .run(new Date(Date.now() + 60_000).toISOString(), sessionBody.data.userId);
    await assert.rejects(
      () =>
        auth.api.verifyTOTP({
          headers: new Headers({ ...browserJsonHeaders, Cookie: jar.header() }),
          body: { code: currentCode.code, trustDevice: false },
        }),
      error =>
        typeof error === 'object' &&
        error !== null &&
        'body' in error &&
        typeof error.body === 'object' &&
        error.body !== null &&
        'code' in error.body &&
        error.body.code === 'ACCOUNT_TEMPORARILY_LOCKED'
    );
    assert.equal(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM "session" WHERE "userId" = ?`)
          .get(sessionBody.data.userId) as { count: number }
      ).count,
      0
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

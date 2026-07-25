import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { serve } from '@hono/node-server';
import { expect, test } from '@playwright/test';
import { createApp } from '../src/server/app.js';
import { createAuth } from '../src/server/auth/auth.js';
import { createBootstrapService } from '../src/server/auth/bootstrap.js';
import { createManagedRevision } from '../src/server/config/repository.js';
import type { RuntimeConfigSnapshot } from '../src/server/config/runtime-config.js';
import { openDatabase } from '../src/server/db/database.js';
import { migrateDatabase } from '../src/server/db/migrator.js';

const setupToken = 'webauthn-e2e-setup-token-with-more-than-thirty-two-characters';
const ownerEmail = 'owner-webauthn@example.com';
const ownerPassword = 'webauthn reference recovery password';
const passkeyName = 'Playwright virtual authenticator';
const execFileAsync = promisify(execFile);

const closeServer = (server: ReturnType<typeof serve>) =>
  new Promise<void>((resolveClose, rejectClose) => {
    server.close(error => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });

const waitForServer = (server: ReturnType<typeof serve>) => {
  if (server.listening) return Promise.resolve();
  return new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      server.removeListener('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });
};

const createTlsFixture = async (directory: string) => {
  const certificatePath = resolve(directory, 'server-cert.pem');
  const keyPath = resolve(directory, 'server-key.pem');
  await execFileAsync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:P-256',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certificatePath,
    '-days',
    '1',
    '-sha256',
    '-subj',
    '/CN=127.0.0.1',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
    '-addext',
    'basicConstraints=critical,CA:FALSE',
    '-addext',
    'keyUsage=critical,digitalSignature',
    '-addext',
    'extendedKeyUsage=serverAuth',
  ]);
  const [cert, key] = await Promise.all([readFile(certificatePath), readFile(keyPath)]);
  return { cert, key };
};

test.use({ ignoreHTTPSErrors: true });

test('completes a real WebAuthn registration and passkey sign-in ceremony', async ({
  context,
  isMobile,
  page,
}, testInfo) => {
  test.skip(
    isMobile,
    'The WebAuthn ceremony is viewport-independent and runs once to avoid duplicate virtual-authenticator contention.'
  );
  test.setTimeout(90_000);

  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-webauthn-'));
  const databasePath = resolve(directory, 'kuma-mieru.sqlite3');
  const baseURL = `https://127.0.0.1:${43_000 + testInfo.workerIndex}`;
  let database: ReturnType<typeof openDatabase>['database'] | null = null;
  let server: ReturnType<typeof serve> | null = null;

  try {
    const tls = await createTlsFixture(directory);
    database = openDatabase(databasePath).database;
    const migration = await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
      appBuild: '2.0.0-webauthn-e2e',
    });
    const revision = createManagedRevision(
      database,
      {
        schemaVersion: 1,
        server: { publicBaseUrl: baseURL },
        sources: [],
        pages: [],
      },
      'system:webauthn-e2e'
    );
    const snapshot: RuntimeConfigSnapshot = {
      mode: 'managed',
      revision: revision.revision,
      contentHash: revision.contentHash,
      loadedAt: new Date().toISOString(),
      config: revision.config,
    };
    const authSecret = 'webauthn-e2e-auth-secret-with-at-least-thirty-two-characters';
    const auth = createAuth({
      database,
      baseURL,
      secret: authSecret,
      trustedOrigins: [baseURL],
    });
    const bootstrap = createBootstrapService({
      database,
      auth,
      providedToken: setupToken,
    });
    bootstrap.initialize();
    const app = createApp({
      snapshot,
      schemaVersion: migration.currentVersion,
      buildVersion: '2.0.0-webauthn-e2e',
      publicDirectory: resolve(process.cwd(), 'dist/v2/client'),
      database,
      auth,
      authSecret,
      trustedOrigins: [baseURL],
      bootstrap,
    });
    server = serve({
      fetch: app.fetch,
      hostname: '127.0.0.1',
      port: 43_000 + testInfo.workerIndex,
      createServer: createHttpsServer,
      serverOptions: tls,
    });
    await waitForServer(server);

    await context.credentials.install();
    await page.goto(`${baseURL}/admin/`);
    expect(
      await page.evaluate(() => ({
        protocol: window.location.protocol,
        secureContext: window.isSecureContext,
      }))
    ).toEqual({ protocol: 'https:', secureContext: true });

    await expect(
      page.getByRole('heading', { level: 1, name: 'Establish the owner.' })
    ).toBeVisible();
    await page.getByLabel('Setup token').fill(setupToken);
    await page.getByLabel('Display name').fill('WebAuthn Owner');
    await page.getByLabel('Email').fill(ownerEmail);
    await page.getByLabel('Recovery password').fill(ownerPassword);
    await page.getByRole('button', { name: 'Create owner' }).click();

    await expect(page.getByRole('heading', { level: 2, name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Email').fill(ownerEmail);
    await page.getByLabel('Password').fill(ownerPassword);
    await page.getByRole('button', { name: 'Enter workbench' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'The system is quiet.' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Security' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Register a passkey' })).toBeVisible();
    await page.getByLabel('Passkey name').fill(passkeyName);
    await page.getByLabel('Authenticator preference').selectOption('platform');
    await page.getByRole('button', { name: 'Register passkey' }).click();

    await expect(page.getByText(passkeyName, { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await context.credentials.get({ rpId: '127.0.0.1' })).length)
      .toBe(1);
    const storedPasskey = database.prepare('SELECT id, name FROM "passkey"').get() as {
      id: string;
      name: string;
    };
    expect(storedPasskey.name).toBe(passkeyName);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Sign in' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue with a passkey' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'The system is quiet.' })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Security' }).click();
    const passkey = page.locator('.security-passkey-list article').filter({ hasText: passkeyName });
    await passkey.getByRole('button', { name: `Delete ${passkeyName}` }).click();
    const deletionReview = page.locator('.access-risk-review');
    await expect(deletionReview.locator('code')).toHaveText(storedPasskey.id);
    await deletionReview.locator('input').fill(storedPasskey.id);
    const deleteButton = deletionReview.getByRole('button', { name: 'Delete passkey' });
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();

    await expect(page.getByText('No passkey registered.')).toBeVisible();
    expect(
      (
        database.prepare('SELECT COUNT(*) AS count FROM "passkey"').get() as {
          count: number;
        }
      ).count
    ).toBe(0);
    expect(
      database
        .prepare(
          `SELECT action, result
           FROM admin_audit
           WHERE action IN ('auth.passkey.register', 'auth.passkey.delete')
           ORDER BY action`
        )
        .all()
    ).toEqual([
      { action: 'auth.passkey.delete', result: 'success' },
      { action: 'auth.passkey.register', result: 'success' },
    ]);
  } finally {
    if (server) await closeServer(server);
    database?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});

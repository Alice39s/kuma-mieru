import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { createAuth } from './auth.js';
import { createBootstrapService } from './bootstrap.js';

test('creates exactly one owner from a hashed one-time setup token', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-bootstrap-'));
  const databasePath = resolve(directory, 'test.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const auth = createAuth({
      database,
      baseURL: 'http://127.0.0.1:3882',
      secret: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH',
    });
    const token = 'setup-token-with-more-than-thirty-two-characters';
    const bootstrap = createBootstrapService({ database, auth, providedToken: token });
    const initialized = bootstrap.initialize();
    assert.equal(initialized?.token, token);
    assert.equal(
      (
        database.prepare('SELECT token_hash FROM auth_bootstrap').get() as { token_hash: string }
      ).token_hash.includes(token),
      false
    );

    const result = await bootstrap.complete(
      { token, email: 'owner@example.com', name: 'Owner', password: 'a-secure-owner-password' },
      'request-1'
    );
    assert.equal(result.role, 'owner');
    assert.deepEqual(bootstrap.status(), { required: false, available: false, expiresAt: null });
    const user = database.prepare('SELECT email, role, emailVerified FROM "user"').get() as Record<
      string,
      unknown
    >;
    assert.deepEqual(user, { email: 'owner@example.com', role: 'owner', emailVerified: 1 });
    const account = database.prepare('SELECT providerId, password FROM account').get() as {
      providerId: string;
      password: string;
    };
    assert.equal(account.providerId, 'credential');
    assert.notEqual(account.password, 'a-secure-owner-password');
    await assert.rejects(
      bootstrap.complete(
        { token, email: 'second@example.com', name: 'Second', password: 'another-secure-password' },
        'request-2'
      ),
      error =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'bootstrap_closed'
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

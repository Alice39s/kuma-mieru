import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { getAdminTwoFactorStatus } from './two-factor-repository.js';

const fixture = () => {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY,
      "twoFactorEnabled" INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE "twoFactor" (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO "user" (id, "twoFactorEnabled") VALUES ('owner-1', 0);
  `);
  return database;
};

test('projects only two-factor state and never credential material', () => {
  const database = fixture();
  assert.deepEqual(getAdminTwoFactorStatus(database, 'owner-1'), {
    enabled: false,
    setupPending: false,
    recoveryCodesConfigured: false,
  });
  database
    .prepare(`INSERT INTO "twoFactor" (id, "userId", verified) VALUES ('2fa-1', 'owner-1', 0)`)
    .run();
  assert.deepEqual(getAdminTwoFactorStatus(database, 'owner-1'), {
    enabled: false,
    setupPending: true,
    recoveryCodesConfigured: false,
  });
  database.prepare(`UPDATE "twoFactor" SET verified = 1 WHERE id = '2fa-1'`).run();
  database.prepare(`UPDATE "user" SET "twoFactorEnabled" = 1 WHERE id = 'owner-1'`).run();
  const status = getAdminTwoFactorStatus(database, 'owner-1');
  assert.deepEqual(status, {
    enabled: true,
    setupPending: false,
    recoveryCodesConfigured: true,
  });
  assert.doesNotMatch(JSON.stringify(status), /secret|backupCodes|lockedUntil|failedVerification/u);
  database.close();
});

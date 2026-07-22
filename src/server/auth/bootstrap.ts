import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { KumaAuth } from './auth.js';

const ownerInputSchema = z.object({
  token: z.string().min(32),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(12).max(200),
});

interface BootstrapRow {
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface CreateBootstrapServiceOptions {
  database: Database.Database;
  auth: KumaAuth;
  providedToken?: string;
  lifetimeMs?: number;
}

const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

const matchesHash = (token: string, expectedHash: string) => {
  const candidate = Buffer.from(hashToken(token));
  const expected = Buffer.from(expectedHash);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};

const bootstrapError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

export const createBootstrapService = ({
  database,
  auth,
  providedToken,
  lifetimeMs = 15 * 60_000,
}: CreateBootstrapServiceOptions) => {
  const initialize = () => {
    const userCount = (
      database.prepare('SELECT COUNT(*) AS count FROM "user"').get() as { count: number }
    ).count;
    if (userCount > 0) return null;
    const token = providedToken ?? randomBytes(32).toString('base64url');
    if (token.length < 32)
      throw new Error('KUMA_MIERU_SETUP_TOKEN must contain at least 32 characters');
    const now = new Date();
    const expiresAt = new Date(now.valueOf() + lifetimeMs);
    database
      .prepare(
        `INSERT INTO auth_bootstrap
          (singleton, token_hash, expires_at, created_at, consumed_at)
         VALUES (1, ?, ?, ?, NULL)
         ON CONFLICT(singleton) DO UPDATE SET
           token_hash = excluded.token_hash,
           expires_at = excluded.expires_at,
           created_at = excluded.created_at,
           consumed_at = NULL`
      )
      .run(hashToken(token), expiresAt.toISOString(), now.toISOString());
    return { token, expiresAt: expiresAt.toISOString() };
  };

  const status = () => {
    const userCount = (
      database.prepare('SELECT COUNT(*) AS count FROM "user"').get() as { count: number }
    ).count;
    const row = database
      .prepare('SELECT token_hash, expires_at, consumed_at FROM auth_bootstrap WHERE singleton = 1')
      .get() as BootstrapRow | undefined;
    return {
      required: userCount === 0,
      available:
        userCount === 0 &&
        Boolean(row && !row.consumed_at && Date.parse(row.expires_at) > Date.now()),
      expiresAt: userCount === 0 ? (row?.expires_at ?? null) : null,
    };
  };

  const complete = async (rawInput: unknown, requestId: string) => {
    const input = ownerInputSchema.parse(rawInput);
    const claim = database.transaction(() => {
      const userCount = (
        database.prepare('SELECT COUNT(*) AS count FROM "user"').get() as { count: number }
      ).count;
      if (userCount > 0)
        throw bootstrapError('bootstrap_closed', 'Owner bootstrap is permanently closed');
      const row = database
        .prepare(
          'SELECT token_hash, expires_at, consumed_at FROM auth_bootstrap WHERE singleton = 1'
        )
        .get() as BootstrapRow | undefined;
      if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) {
        throw bootstrapError('setup_token_expired', 'Setup token is unavailable or expired');
      }
      if (!matchesHash(input.token, row.token_hash)) {
        throw bootstrapError('setup_token_invalid', 'Setup token is invalid');
      }
      const claimedAt = new Date().toISOString();
      const result = database
        .prepare(
          `UPDATE auth_bootstrap SET consumed_at = ?
           WHERE singleton = 1 AND consumed_at IS NULL AND token_hash = ?`
        )
        .run(claimedAt, row.token_hash);
      if (result.changes !== 1)
        throw bootstrapError('bootstrap_conflict', 'Owner bootstrap is already in progress');
      return claimedAt;
    })();

    let userId: string | null = null;
    try {
      const context = await auth.$context;
      const user = await context.internalAdapter.createUser({
        email: input.email.toLowerCase(),
        name: input.name,
        emailVerified: true,
        role: 'owner',
      });
      userId = user.id;
      const password = await context.password.hash(input.password);
      await context.internalAdapter.linkAccount({
        accountId: user.id,
        providerId: 'credential',
        password,
        userId: user.id,
      });
      database
        .prepare(
          `INSERT INTO admin_audit
            (id, occurred_at, actor_id, action, target_type, target_id, request_id, result, after_json)
           VALUES (?, ?, ?, 'auth.bootstrap', 'user', ?, ?, 'success', ?)`
        )
        .run(
          randomUUID(),
          new Date().toISOString(),
          user.id,
          user.id,
          requestId,
          JSON.stringify({ role: 'owner' })
        );
      return { userId: user.id, role: 'owner' as const };
    } catch (error) {
      const context = await auth.$context;
      if (userId) await context.internalAdapter.deleteUser(userId);
      database
        .prepare(
          'UPDATE auth_bootstrap SET consumed_at = NULL WHERE singleton = 1 AND consumed_at = ?'
        )
        .run(claim);
      throw error;
    }
  };

  return { initialize, status, complete };
};

export type BootstrapService = ReturnType<typeof createBootstrapService>;

import { passkey } from '@better-auth/passkey';
import type Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';

export type AdminRole = 'owner' | 'publisher' | 'editor' | 'viewer';

export interface CreateAuthOptions {
  database: Database.Database;
  baseURL: string;
  secret: string;
  trustedOrigins?: string[];
}

export const createAuth = ({
  database,
  baseURL,
  secret,
  trustedOrigins = [baseURL],
}: CreateAuthOptions) =>
  betterAuth({
    appName: 'Kuma Mieru',
    database,
    baseURL,
    basePath: '/api/auth',
    secret,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
    },
    disabledPaths: [
      '/passkey/list-user-passkeys',
      '/passkey/delete-passkey',
      '/passkey/update-passkey',
      '/passkey/generate-register-options',
      '/passkey/verify-registration',
      '/two-factor/enable',
      '/two-factor/disable',
      '/two-factor/generate-backup-codes',
      '/two-factor/get-totp-uri',
      '/two-factor/send-otp',
      '/two-factor/verify-otp',
    ],
    user: {
      additionalFields: {
        role: {
          type: ['owner', 'publisher', 'editor', 'viewer'],
          required: true,
          defaultValue: 'viewer',
          input: false,
        },
      },
    },
    advanced: {
      cookiePrefix: 'kuma_mieru',
      useSecureCookies: new URL(baseURL).protocol === 'https:',
      defaultCookieAttributes: {
        httpOnly: true,
        secure: new URL(baseURL).protocol === 'https:',
        sameSite: 'lax',
        path: '/',
      },
    },
    rateLimit: {
      enabled: true,
      window: 10,
      max: 100,
      customRules: {
        '/passkey/generate-authenticate-options': { window: 60, max: 10 },
        '/passkey/verify-authentication': { window: 60, max: 10 },
      },
    },
    plugins: [
      passkey(),
      twoFactor({
        issuer: 'Kuma Mieru',
        backupCodeOptions: { storeBackupCodes: 'encrypted' },
        accountLockout: {
          enabled: true,
          maxFailedAttempts: 10,
          durationSeconds: 15 * 60,
        },
      }),
    ],
  });

export type KumaAuth = ReturnType<typeof createAuth>;

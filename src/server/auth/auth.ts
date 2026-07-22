import { passkey } from '@better-auth/passkey';
import type Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';

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
    plugins: [passkey()],
  });

export type KumaAuth = ReturnType<typeof createAuth>;

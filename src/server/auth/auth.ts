import { passkey } from '@better-auth/passkey';
import type Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { genericOAuth, twoFactor } from 'better-auth/plugins';
import type { OidcRuntimeConfig } from './oidc.js';

export type AdminRole = 'owner' | 'publisher' | 'editor' | 'viewer';

export interface CreateAuthOptions {
  database: Database.Database;
  baseURL: string;
  secret: string;
  trustedOrigins?: string[];
  oidc?: OidcRuntimeConfig | null;
}

export const createAuth = ({
  database,
  baseURL,
  secret,
  trustedOrigins = [baseURL],
  oidc,
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
        '/sign-in/oauth2': { window: 60, max: 10 },
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
      ...(oidc
        ? [
            genericOAuth({
              config: [
                {
                  providerId: oidc.providerId,
                  issuer: oidc.issuer,
                  requireIssuerValidation: true,
                  authorizationUrl: oidc.authorizationUrl,
                  tokenUrl: oidc.tokenUrl,
                  userInfoUrl: oidc.userInfoUrl,
                  clientId: oidc.clientId,
                  clientSecret: oidc.clientSecret,
                  scopes: ['openid'],
                  responseType: 'code',
                  pkce: true,
                  prompt: 'select_account',
                  disableImplicitSignUp: true,
                  disableSignUp: true,
                  overrideUserInfo: false,
                  getToken: oidc.getToken,
                  getUserInfo: oidc.getUserInfo,
                },
              ],
            }),
          ]
        : []),
    ],
  });

export type KumaAuth = ReturnType<typeof createAuth>;

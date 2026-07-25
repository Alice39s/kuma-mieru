import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { errorResponse, type AppEnvironment } from '../api/errors.js';
import type { KumaAuth } from './auth.js';
import type { OidcControlPlane } from './oidc.js';
import { isTrustedBrowserMutation } from './security.js';

const signInSchema = z
  .object({
    email: z.email(),
    password: z.string().min(1).max(1024),
  })
  .strict();

const totpChallengeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .length(6)
      .refine(code => [...code].every(character => character >= '0' && character <= '9')),
    trustDevice: z.boolean().optional(),
  })
  .strict();

const backupCodeChallengeSchema = z
  .object({
    code: z.string().trim().min(1).max(128),
    trustDevice: z.boolean().optional(),
  })
  .strict();

const passkeyAuthenticationSchema = z
  .object({ response: z.record(z.string(), z.unknown()) })
  .strict();

const forwardAuthHeaders = (context: Context<AppEnvironment>, headers: Headers) => {
  for (const cookie of headers.getSetCookie()) {
    context.header('Set-Cookie', cookie, { append: true });
  }
  const retryAfter = headers.get('retry-after') ?? headers.get('x-retry-after');
  if (retryAfter) context.header('Retry-After', retryAfter);
};

const authUnavailable = (context: Context<AppEnvironment>) =>
  errorResponse(context, 503, 'AUTH_NOT_READY', 'Authentication service is unavailable');

const invalidAuthentication = (context: Context<AppEnvironment>) =>
  errorResponse(context, 401, 'AUTHENTICATION_FAILED', 'Authentication could not be verified');

const dispatchAuthRequest = (
  context: Context<AppEnvironment>,
  auth: KumaAuth,
  path: string,
  body: unknown,
  method: 'GET' | 'POST' = 'POST',
  baseURL?: string
) => {
  const url = new URL(`/api/auth${path}`, baseURL ?? context.req.url);
  url.search = '';
  const headers = new Headers(context.req.raw.headers);
  if (method === 'POST') headers.set('content-type', 'application/json');
  return auth.handler(
    new Request(url, {
      method,
      headers,
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    })
  );
};

const authenticationFailure = (context: Context<AppEnvironment>, response: Response) => {
  forwardAuthHeaders(context, response.headers);
  if (response.status !== 429) return invalidAuthentication(context);
  const retryAfter =
    response.headers.get('retry-after') ?? response.headers.get('x-retry-after') ?? '900';
  return errorResponse(context, 429, 'AUTHENTICATION_RATE_LIMITED', 'Try again later', undefined, {
    'Retry-After': retryAfter,
  });
};

const requireTrustedJson = (
  context: Context<AppEnvironment>,
  trustedOrigins: string[]
): Response | null => {
  if (!isTrustedBrowserMutation(context.req.raw, trustedOrigins)) {
    return errorResponse(context, 403, 'UNTRUSTED_ORIGIN', 'Authentication origin is not trusted');
  }
  if (!context.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
    return errorResponse(context, 415, 'JSON_REQUIRED', 'Authentication requests require JSON');
  }
  return null;
};

export const registerAuthenticationRoutes = (
  app: Hono<AppEnvironment>,
  {
    auth,
    getAuth,
    oidc,
    trustedOrigins,
  }: {
    auth?: KumaAuth;
    getAuth?: () => KumaAuth;
    oidc?: OidcControlPlane;
    trustedOrigins: string[];
  }
) => {
  const currentAuth = () => getAuth?.() ?? auth;

  app.use(
    '/api/v1/auth/*',
    bodyLimit({
      maxSize: 32 * 1024,
      onError: context =>
        errorResponse(context, 413, 'BODY_TOO_LARGE', 'Authentication body exceeds 32 KiB'),
    })
  );

  app.use('/api/v1/auth/*', async (context, next) => {
    await next();
    context.header('Cache-Control', 'no-store');
  });

  app.get('/api/v1/auth/methods', context =>
    context.json({
      data: {
        passkey: true,
        password: true,
        oidc: oidc?.getPublicProvider() ?? null,
      },
    })
  );

  app.post('/api/v1/auth/oidc', async context => {
    const rejected = requireTrustedJson(context, trustedOrigins);
    if (rejected) return rejected;
    const provider = oidc?.getPublicProvider();
    const resolvedAuth = currentAuth();
    if (!provider || !resolvedAuth) return authUnavailable(context);
    try {
      z.object({})
        .strict()
        .parse(await context.req.json());
      const trustedOrigin = context.req.header('Origin') ?? trustedOrigins[0];
      if (!trustedOrigin) return authUnavailable(context);
      const callbackURL = new URL('/admin', trustedOrigin).toString();
      const errorCallbackURL = new URL('/admin?authError=oidc', trustedOrigin).toString();
      const authResponse = await dispatchAuthRequest(
        context,
        resolvedAuth,
        '/sign-in/oauth2',
        {
          providerId: provider.providerId,
          callbackURL,
          errorCallbackURL,
          disableRedirect: true,
          requestSignUp: false,
        },
        'POST',
        trustedOrigin
      );
      if (!authResponse.ok) return authenticationFailure(context, authResponse);
      forwardAuthHeaders(context, authResponse.headers);
      const response = z
        .object({
          url: z.url(),
          redirect: z.boolean(),
        })
        .parse(await authResponse.json());
      if (!oidc?.isAuthorizationUrlAllowed(response.url)) {
        return errorResponse(
          context,
          502,
          'OIDC_AUTHORIZATION_URL_REJECTED',
          'OIDC authorization endpoint is invalid'
        );
      }
      return context.json({ data: { url: response.url } });
    } catch {
      return invalidAuthentication(context);
    }
  });

  app.post('/api/v1/auth/sign-in', async context => {
    const rejected = requireTrustedJson(context, trustedOrigins);
    if (rejected) return rejected;
    const resolvedAuth = currentAuth();
    if (!resolvedAuth) return authUnavailable(context);
    try {
      const input = signInSchema.parse(await context.req.json());
      const authResponse = await dispatchAuthRequest(
        context,
        resolvedAuth,
        '/sign-in/email',
        input
      );
      if (!authResponse.ok) return authenticationFailure(context, authResponse);
      forwardAuthHeaders(context, authResponse.headers);
      const response = (await authResponse.json()) as {
        twoFactorRedirect?: unknown;
        twoFactorMethods?: unknown;
      };
      if (response.twoFactorRedirect === true) {
        const methods = Array.isArray(response.twoFactorMethods)
          ? response.twoFactorMethods.filter(method => method === 'totp')
          : [];
        return context.json({
          data: {
            state: 'two_factor_required' as const,
            methods: [...methods, 'backup_code'],
          },
        });
      }
      return context.json({ data: { state: 'authenticated' as const } });
    } catch {
      return invalidAuthentication(context);
    }
  });

  app.post('/api/v1/auth/passkey/options', async context => {
    const rejected = requireTrustedJson(context, trustedOrigins);
    if (rejected) return rejected;
    const resolvedAuth = currentAuth();
    if (!resolvedAuth) return authUnavailable(context);
    try {
      z.object({})
        .strict()
        .parse(await context.req.json());
      const authResponse = await dispatchAuthRequest(
        context,
        resolvedAuth,
        '/passkey/generate-authenticate-options',
        undefined,
        'GET'
      );
      if (!authResponse.ok) return authenticationFailure(context, authResponse);
      forwardAuthHeaders(context, authResponse.headers);
      return context.json({ data: await authResponse.json() });
    } catch {
      return invalidAuthentication(context);
    }
  });

  app.post('/api/v1/auth/passkey/verify', async context => {
    const rejected = requireTrustedJson(context, trustedOrigins);
    if (rejected) return rejected;
    const resolvedAuth = currentAuth();
    if (!resolvedAuth) return authUnavailable(context);
    try {
      const input = passkeyAuthenticationSchema.parse(await context.req.json());
      const authResponse = await dispatchAuthRequest(
        context,
        resolvedAuth,
        '/passkey/verify-authentication',
        input
      );
      if (!authResponse.ok) return authenticationFailure(context, authResponse);
      forwardAuthHeaders(context, authResponse.headers);
      return context.json({ data: { state: 'authenticated' as const } });
    } catch {
      return invalidAuthentication(context);
    }
  });

  app.post('/api/v1/auth/two-factor/totp', async context => {
    const rejected = requireTrustedJson(context, trustedOrigins);
    if (rejected) return rejected;
    const resolvedAuth = currentAuth();
    if (!resolvedAuth) return authUnavailable(context);
    try {
      const input = totpChallengeSchema.parse(await context.req.json());
      const authResponse = await dispatchAuthRequest(
        context,
        resolvedAuth,
        '/two-factor/verify-totp',
        input
      );
      if (!authResponse.ok) return authenticationFailure(context, authResponse);
      forwardAuthHeaders(context, authResponse.headers);
      return context.json({ data: { state: 'authenticated' as const } });
    } catch {
      return invalidAuthentication(context);
    }
  });

  app.post('/api/v1/auth/two-factor/backup-code', async context => {
    const rejected = requireTrustedJson(context, trustedOrigins);
    if (rejected) return rejected;
    const resolvedAuth = currentAuth();
    if (!resolvedAuth) return authUnavailable(context);
    try {
      const input = backupCodeChallengeSchema.parse(await context.req.json());
      const authResponse = await dispatchAuthRequest(
        context,
        resolvedAuth,
        '/two-factor/verify-backup-code',
        input
      );
      if (!authResponse.ok) return authenticationFailure(context, authResponse);
      forwardAuthHeaders(context, authResponse.headers);
      return context.json({ data: { state: 'authenticated' as const } });
    } catch {
      return invalidAuthentication(context);
    }
  });
};

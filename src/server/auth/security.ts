import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { KumaAuth } from './auth.js';

const roleSchema = z.enum(['owner', 'publisher', 'editor', 'viewer']);

export interface AdminPrincipal {
  userId: string;
  role: z.infer<typeof roleSchema>;
  sessionId: string;
  sessionCreatedAt: Date;
}

export const getAdminPrincipal = async (
  auth: KumaAuth | undefined,
  headers: Headers
): Promise<AdminPrincipal | null> => {
  if (!auth) return null;
  const result = await auth.api.getSession({ headers });
  if (!result) return null;
  const role = roleSchema.safeParse(result.user.role);
  if (!role.success) return null;
  return {
    userId: result.user.id,
    role: role.data,
    sessionId: result.session.id,
    sessionCreatedAt: new Date(result.session.createdAt),
  };
};

export const createCsrfToken = (secret: string, sessionId: string) =>
  createHmac('sha256', secret).update(`admin-csrf:${sessionId}`, 'utf8').digest('base64url');

export const verifyCsrfToken = (
  secret: string,
  sessionId: string,
  candidate: string | undefined
) => {
  if (!candidate) return false;
  const expected = Buffer.from(createCsrfToken(secret, sessionId));
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
};

export const hasRole = (principal: AdminPrincipal, allowed: AdminPrincipal['role'][]) =>
  allowed.includes(principal.role);

export const isRecentlyAuthenticated = (principal: AdminPrincipal, maximumAgeMs = 5 * 60_000) =>
  Date.now() - principal.sessionCreatedAt.valueOf() <= maximumAgeMs;

export const isTrustedBrowserMutation = (request: Request, trustedOrigins: string[]) => {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  return Boolean(
    origin &&
    trustedOrigins.includes(origin) &&
    fetchSite === 'same-origin' &&
    request.method !== 'GET'
  );
};

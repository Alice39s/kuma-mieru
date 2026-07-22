import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const noncePayloadSchema = z.object({
  pageId: z.string().min(1),
  salt: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export interface SubscriptionNonceService {
  create(pageId: string): { nonce: string; expiresAt: string };
  verify(pageId: string, nonce: string): boolean;
}

export const createSubscriptionNonceService = (
  secret: string,
  lifetimeMs = 15 * 60_000
): SubscriptionNonceService => {
  const sign = (payload: string) =>
    createHmac('sha256', secret)
      .update(`subscription-nonce:${payload}`, 'utf8')
      .digest('base64url');
  const create = (pageId: string) => {
    const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
    const payload = Buffer.from(
      JSON.stringify({ pageId, salt: randomBytes(16).toString('base64url'), expiresAt }),
      'utf8'
    ).toString('base64url');
    return { nonce: `${payload}.${sign(payload)}`, expiresAt };
  };
  const verify = (pageId: string, nonce: string) => {
    const [payload, signature, ...extra] = nonce.split('.');
    if (!payload || !signature || extra.length > 0) return false;
    const expected = Buffer.from(sign(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
    try {
      const decoded = noncePayloadSchema.parse(
        JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      );
      return decoded.pageId === pageId && Date.parse(decoded.expiresAt) > Date.now();
    } catch {
      return false;
    }
  };
  return { create, verify };
};

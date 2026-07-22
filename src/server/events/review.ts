import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AdminPrincipal } from '../auth/security.js';

const reviewPayloadSchema = z.object({
  eventId: z.string().uuid(),
  eventVersion: z.number().int().positive(),
  notifySubscribers: z.boolean(),
  estimatedRecipients: z.number().int().nonnegative(),
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export interface PublicationReviewTokenInput {
  eventId: string;
  eventVersion: number;
  notifySubscribers: boolean;
  estimatedRecipients: number;
  principal: AdminPrincipal;
}

export interface PublicationReviewService {
  create(input: PublicationReviewTokenInput): { nonce: string; expiresAt: string };
  verify(input: PublicationReviewTokenInput, nonce: string): boolean;
}

export const createPublicationReviewService = (
  secret: string,
  lifetimeMs = 5 * 60_000
): PublicationReviewService => {
  const sign = (payload: string) =>
    createHmac('sha256', secret)
      .update(`publication-review:${payload}`, 'utf8')
      .digest('base64url');

  const create = (input: PublicationReviewTokenInput) => {
    const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
    const payload = Buffer.from(
      JSON.stringify({
        eventId: input.eventId,
        eventVersion: input.eventVersion,
        notifySubscribers: input.notifySubscribers,
        estimatedRecipients: input.estimatedRecipients,
        userId: input.principal.userId,
        sessionId: input.principal.sessionId,
        expiresAt,
      }),
      'utf8'
    ).toString('base64url');
    return { nonce: `${payload}.${sign(payload)}`, expiresAt };
  };

  const verify = (input: PublicationReviewTokenInput, nonce: string) => {
    const [payload, signature, ...extra] = nonce.split('.');
    if (!payload || !signature || extra.length > 0) return false;
    const expected = Buffer.from(sign(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
    try {
      const decoded = reviewPayloadSchema.parse(
        JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      );
      return (
        decoded.eventId === input.eventId &&
        decoded.eventVersion === input.eventVersion &&
        decoded.notifySubscribers === input.notifySubscribers &&
        decoded.estimatedRecipients === input.estimatedRecipients &&
        decoded.userId === input.principal.userId &&
        decoded.sessionId === input.principal.sessionId &&
        Date.parse(decoded.expiresAt) > Date.now()
      );
    } catch {
      return false;
    }
  };

  return { create, verify };
};

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AdminPrincipal } from '../auth/security.js';
import { createPublicationReviewService } from './review.js';

const principal: AdminPrincipal = {
  userId: 'owner-1',
  role: 'owner',
  sessionId: 'session-1',
  sessionCreatedAt: new Date(),
};

test('binds publication review nonces to actor, session, version and notification choice', () => {
  const service = createPublicationReviewService('publication-review-secret-with-enough-entropy');
  const input = {
    eventId: 'f20e87ce-1d75-4a4c-b10a-e7eb47463df2',
    eventVersion: 3,
    notifySubscribers: true,
    estimatedRecipients: 12,
    principal,
  };
  const review = service.create(input);
  assert.equal(service.verify(input, review.nonce), true);
  assert.equal(service.verify({ ...input, eventVersion: 4 }, review.nonce), false);
  assert.equal(service.verify({ ...input, notifySubscribers: false }, review.nonce), false);
  assert.equal(
    service.verify(
      { ...input, principal: { ...principal, sessionId: 'another-session' } },
      review.nonce
    ),
    false
  );
  const expired = createPublicationReviewService(
    'publication-review-secret-with-enough-entropy',
    -1
  ).create(input);
  assert.equal(service.verify(input, expired.nonce), false);
});

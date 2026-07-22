import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubscriptionNonceService } from './nonce.js';

test('binds anonymous subscription nonces to one page and expiry window', () => {
  const service = createSubscriptionNonceService('subscription-nonce-secret-with-enough-entropy');
  const result = service.create('public');
  assert.equal(service.verify('public', result.nonce), true);
  assert.equal(service.verify('another-page', result.nonce), false);
  assert.equal(service.verify('public', `${result.nonce}tampered`), false);
  const expired = createSubscriptionNonceService(
    'subscription-nonce-secret-with-enough-entropy',
    -1
  ).create('public');
  assert.equal(service.verify('public', expired.nonce), false);
});

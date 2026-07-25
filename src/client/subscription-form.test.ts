import { expect, test } from 'bun:test';
import {
  normalizePublicSubscriptionInput,
  publicSubscriptionFormSchema,
  subscriptionScopeSchema,
} from './subscription-form';

test('normalizes an email and stable component scope without leaking the empty honeypot', () => {
  expect(
    normalizePublicSubscriptionInput({
      email: '  Person@Example.COM ',
      componentIds: ['worker', 'api', 'api'],
      website: '',
    })
  ).toEqual({
    email: 'person@example.com',
    componentIds: ['api', 'worker'],
  });
});

test('rejects malformed email and an empty component-only management scope', () => {
  expect(
    publicSubscriptionFormSchema.safeParse({
      email: 'not-an-address',
      componentIds: [],
      website: '',
    }).success
  ).toBe(false);
  expect(subscriptionScopeSchema.safeParse({ scope: 'components', componentIds: [] }).success).toBe(
    false
  );
  expect(subscriptionScopeSchema.safeParse({ scope: 'page', componentIds: [] }).success).toBe(true);
});

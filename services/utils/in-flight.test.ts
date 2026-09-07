import { expect, test } from 'bun:test';
import { createInFlightLoader } from './in-flight';

test('overlapping consumers share a request, but settled results are not cached', async () => {
  const load = createInFlightLoader<string, number>();
  const pending = Promise.withResolvers<number>();
  let calls = 0;
  const fetchValue = () => {
    calls++;
    return pending.promise;
  };
  const first = load('page', fetchValue);
  const second = load('page', fetchValue);
  expect(first).toBe(second);
  expect(calls).toBe(1);
  pending.resolve(1);
  expect(await first).toBe(1);
  expect(await load('page', () => Promise.resolve(2))).toBe(2);
});

test('failed requests are evicted and a different page can run independently', async () => {
  const load = createInFlightLoader<string, number>();
  const failure = new Error('upstream failed');
  const first = load('page', () => Promise.reject(failure));
  expect(await load('another-page', () => Promise.resolve(2))).toBe(2);
  await expect(first).rejects.toThrow('upstream failed');
  expect(await load('page', () => Promise.resolve(3))).toBe(3);
});

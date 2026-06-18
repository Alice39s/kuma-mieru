import { expect, test } from 'bun:test';
import { createIntegerStringSchema } from './number-schema';

test('createIntegerStringSchema parses trimmed integer strings', () => {
  const schema = createIntegerStringSchema({ min: 100, max: 599 });

  expect(schema.parse(' 503 ')).toBe(503);
});

test('createIntegerStringSchema rejects malformed and decimal strings', () => {
  const schema = createIntegerStringSchema({ min: 0 });

  expect(schema.safeParse('12.5').success).toBe(false);
  expect(schema.safeParse('2MB').success).toBe(false);
  expect(schema.safeParse('').success).toBe(false);
});

test('createIntegerStringSchema applies range and safe integer constraints', () => {
  const schema = createIntegerStringSchema({ min: 0, max: 599 });

  expect(schema.safeParse('-1').success).toBe(false);
  expect(schema.safeParse('600').success).toBe(false);
  expect(schema.safeParse('9007199254740992').success).toBe(false);
});

import { expect, test } from 'bun:test';
import { parse, safeParse } from 'valibot';
import { envFlag, envIntWithDefault } from './common';

const retrySchema = envIntWithDefault('REQUEST_RETRY_MAX', 3, 0, 10);
const flagSchema = envFlag('ALLOW_INSECURE_TLS');

test('envIntWithDefault falls back to the default for missing or empty values', () => {
  expect(parse(retrySchema, undefined)).toBe(3);
  expect(parse(retrySchema, '')).toBe(3);
});

test('envIntWithDefault converts integer strings within the range', () => {
  expect(parse(retrySchema, '0')).toBe(0);
  expect(parse(retrySchema, '10')).toBe(10);
});

test('envIntWithDefault rejects values outside the range or not integers', () => {
  for (const value of ['11', '-1', '2.5', 'abc']) {
    const result = safeParse(retrySchema, value);
    expect(result.success).toBe(false);
    expect(result.issues?.[0]?.message).toBe(
      'REQUEST_RETRY_MAX must be an integer between 0 and 10'
    );
  }
});

test('envFlag maps "true" and "false" and defaults to false', () => {
  expect(parse(flagSchema, 'true')).toBe(true);
  expect(parse(flagSchema, 'false')).toBe(false);
  expect(parse(flagSchema, undefined)).toBe(false);
});

test('envFlag rejects other values with the variable name', () => {
  const result = safeParse(flagSchema, 'yes');
  expect(result.success).toBe(false);
  expect(result.issues?.[0]?.message).toBe('ALLOW_INSECURE_TLS must be "true" or "false"');
});

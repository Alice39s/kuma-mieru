import { expect, test } from 'bun:test';
import { booleanEnvSchema, parseBooleanEnvWithDefault } from './boolean-schema';

test('booleanEnvSchema parses true and false strings case-insensitively', () => {
  expect(booleanEnvSchema.parse('TRUE')).toBe(true);
  expect(booleanEnvSchema.parse(' false ')).toBe(false);
});

test('booleanEnvSchema defaults missing values to false', () => {
  expect(booleanEnvSchema.parse(undefined)).toBe(false);
});

test('booleanEnvSchema rejects malformed boolean strings', () => {
  expect(booleanEnvSchema.safeParse('yes').success).toBe(false);
});

test('parseBooleanEnvWithDefault preserves loose feature flag fallback behavior', () => {
  expect(parseBooleanEnvWithDefault(undefined, true)).toBe(true);
  expect(parseBooleanEnvWithDefault('TRUE', false)).toBe(true);
  expect(parseBooleanEnvWithDefault('yes', true)).toBe(false);
});

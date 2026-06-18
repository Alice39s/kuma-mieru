import { afterEach, expect, test } from 'bun:test';
import { getBoolean, getBooleanWithSource } from './env';

const envKeys = [
  'KUMA_MIERU_EDIT_THIS_PAGE',
  'FEATURE_EDIT_THIS_PAGE',
  'KUMA_MIERU_SHOW_STAR_BUTTON',
  'FEATURE_SHOW_STAR_BUTTON',
];

const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    const originalValue = originalEnv.get(key);

    if (originalValue === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = originalValue;
  }
});

function setEnv(overrides) {
  for (const key of envKeys) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

test('getBoolean uses defaults when aliased env values are missing', () => {
  setEnv({});

  expect(getBoolean('KUMA_MIERU_EDIT_THIS_PAGE', true)).toBe(true);
  expect(getBooleanWithSource('KUMA_MIERU_SHOW_STAR_BUTTON', false)).toEqual({
    value: false,
  });
});

test('getBoolean parses true strings case-insensitively', () => {
  setEnv({
    KUMA_MIERU_EDIT_THIS_PAGE: ' TRUE ',
  });

  expect(getBoolean('KUMA_MIERU_EDIT_THIS_PAGE', false)).toBe(true);
  expect(getBooleanWithSource('KUMA_MIERU_EDIT_THIS_PAGE', false)).toEqual({
    value: true,
    source: 'KUMA_MIERU_EDIT_THIS_PAGE',
  });
});

test('getBoolean preserves loose false fallback for malformed strings', () => {
  setEnv({
    FEATURE_SHOW_STAR_BUTTON: 'yes',
  });

  expect(getBoolean('KUMA_MIERU_SHOW_STAR_BUTTON', true)).toBe(false);
  expect(getBooleanWithSource('KUMA_MIERU_SHOW_STAR_BUTTON', true)).toEqual({
    value: false,
    source: 'FEATURE_SHOW_STAR_BUTTON',
  });
});

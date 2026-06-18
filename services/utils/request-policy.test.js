import { afterEach, expect, test } from 'bun:test';

const envKeys = [
  'REQUEST_RETRY_MAX',
  'REQUEST_RETRY_DELAY_MS',
  'REQUEST_TIMEOUT_MS',
  'ALLOW_INSECURE_TLS',
  'SSR_STRICT_MODE',
];

const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]));
let importCounter = 0;

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

function setRequestPolicyEnv(overrides) {
  for (const key of envKeys) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

function importRequestPolicy() {
  importCounter += 1;
  return import(`./request-policy.ts?test=${importCounter}`);
}

test('request policy numeric env values treat whitespace as empty defaults', async () => {
  setRequestPolicyEnv({
    REQUEST_RETRY_MAX: '   ',
    REQUEST_RETRY_DELAY_MS: '\t',
    REQUEST_TIMEOUT_MS: '\n',
  });

  const { customFetchOptions } = await importRequestPolicy();

  expect(customFetchOptions.maxRetries).toBe(3);
  expect(customFetchOptions.retryDelay).toBe(500);
  expect(customFetchOptions.timeout).toBe(8000);
});

test('request policy numeric env values reject malformed numbers', async () => {
  setRequestPolicyEnv({
    REQUEST_RETRY_MAX: '3retries',
  });

  await expect(importRequestPolicy()).rejects.toThrow('Invalid input');
});

test('request policy boolean env values parse case-insensitively', async () => {
  setRequestPolicyEnv({
    ALLOW_INSECURE_TLS: ' TRUE ',
    SSR_STRICT_MODE: 'false',
  });

  const { allowInsecureTls, isSsrStrictMode } = await importRequestPolicy();

  expect(allowInsecureTls).toBe(true);
  expect(isSsrStrictMode).toBe(false);
});

test('request policy boolean env values reject malformed strings', async () => {
  setRequestPolicyEnv({
    ALLOW_INSECURE_TLS: 'yes',
  });

  await expect(importRequestPolicy()).rejects.toThrow();
});

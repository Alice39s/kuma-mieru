import { afterEach, expect, test } from 'bun:test';
import { parseStatusPageUrl, resolveEndpointConfig } from './uptime-kuma';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

test('parseStatusPageUrl resolves base URL and page id from status URLs', () => {
  expect(parseStatusPageUrl('https://example.com/prefix/status/main')).toEqual({
    baseUrl: 'https://example.com/prefix',
    pageId: 'main',
  });
});

test('parseStatusPageUrl rejects encoded slash page ids', () => {
  expect(() => parseStatusPageUrl('https://example.com/status/team%2Fprod')).toThrow(
    'Invalid page id'
  );
});

test('resolveEndpointConfig rejects invalid legacy PAGE_ID entries', () => {
  process.env.UPTIME_KUMA_URLS = '';
  process.env.UPTIME_KUMA_BASE_URL = 'https://example.com';
  process.env.PAGE_ID = 'main,team/prod';

  expect(() => resolveEndpointConfig()).toThrow('Invalid page id');
});

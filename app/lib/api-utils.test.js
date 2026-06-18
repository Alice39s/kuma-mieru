import { afterEach, expect, test } from 'bun:test';
import {
  createApiResponse,
  getApiResultHeaders,
  getApiResultResponseInit,
  getPageIdFromRequest,
} from './api-utils';

const originalConsoleError = console.error;

afterEach(() => {
  console.error = originalConsoleError;
});

test('getPageIdFromRequest returns undefined for missing or blank pageId', () => {
  expect(getPageIdFromRequest(new Request('https://example.test/api/config'))).toBeUndefined();
  expect(
    getPageIdFromRequest(new Request('https://example.test/api/config?pageId=   '))
  ).toBeUndefined();
});

test('getPageIdFromRequest trims non-empty pageId values', () => {
  expect(
    getPageIdFromRequest(new Request('https://example.test/api/config?pageId=%20ops%20'))
  ).toBe('ops');
});

test('getPageIdFromRequest rejects pageId values outside the configured allowlist', () => {
  expect(
    getPageIdFromRequest(new Request('https://example.test/api/config?pageId=ops'), ['ops'])
  ).toBe('ops');
  expect(
    getPageIdFromRequest(new Request('https://example.test/api/config?pageId=unknown'), ['ops'])
  ).toBeUndefined();
});

test('getApiResultHeaders disables caching for failed upstream results', () => {
  expect(getApiResultHeaders('all_failed')).toEqual({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
});

test('getApiResultHeaders enables short shared caching for healthy upstream results', () => {
  expect(getApiResultHeaders('ok')).toEqual({
    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
  });
});

test('getApiResultResponseInit maps upstream result status to response init', () => {
  expect(getApiResultResponseInit('ok')).toEqual({
    status: 200,
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
    },
  });

  expect(getApiResultResponseInit('partial_failed')).toEqual({
    status: 200,
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
    },
  });

  expect(getApiResultResponseInit('all_failed')).toEqual({
    status: 503,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
});

test('createApiResponse redacts unexpected error messages and disables error caching', async () => {
  console.error = () => {};

  const response = await createApiResponse(async () => {
    throw new Error('database password leaked in stack');
  });

  expect(response.status).toBe(500);
  expect(response.headers.get('Cache-Control')).toBe(
    'no-store, no-cache, must-revalidate, proxy-revalidate'
  );

  const body = await response.json();
  expect(body.error).toBe('Internal Server Error');
  expect(JSON.stringify(body)).not.toContain('database password leaked');
});

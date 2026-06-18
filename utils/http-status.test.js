import { expect, test } from 'bun:test';
import {
  extractHttpStatusCodeFromMessage,
  extractHttpStatusDetailsFromMessage,
  parseHttpStatusCode,
} from './http-status';

test('parseHttpStatusCode accepts only valid HTTP status code strings', () => {
  expect(parseHttpStatusCode('503')).toBe(503);
  expect(parseHttpStatusCode(' 404 ')).toBe(404);
  expect(parseHttpStatusCode('404x')).toBeUndefined();
  expect(parseHttpStatusCode('99')).toBeUndefined();
  expect(parseHttpStatusCode('600')).toBeUndefined();
});

test('extractHttpStatusDetailsFromMessage parses status code and reason phrase', () => {
  expect(
    extractHttpStatusDetailsFromMessage('Upstream failed with 503 Service Unavailable')
  ).toEqual({
    statusCode: 503,
    statusMessage: 'Service Unavailable',
  });
});

test('extractHttpStatusDetailsFromMessage parses valid non-error status details', () => {
  expect(extractHttpStatusDetailsFromMessage('Redirected with 302 Found')).toEqual({
    statusCode: 302,
    statusMessage: 'Found',
  });
});

test('extractHttpStatusCodeFromMessage parses valid status code tokens', () => {
  expect(extractHttpStatusCodeFromMessage('Request failed with 404 Not Found')).toBe(404);
  expect(extractHttpStatusCodeFromMessage('Redirected with 302 Found')).toBe(302);
});

test('extractHttpStatusCodeFromMessage ignores malformed status code tokens', () => {
  expect(extractHttpStatusCodeFromMessage('Request failed with 503oops')).toBeUndefined();
  expect(extractHttpStatusCodeFromMessage('Request failed with 99')).toBeUndefined();
  expect(extractHttpStatusCodeFromMessage('Request failed with 600')).toBeUndefined();
});

test('extractHttpStatusDetailsFromMessage ignores malformed status codes', () => {
  expect(
    extractHttpStatusDetailsFromMessage('Request failed with 503oops Bad Gateway')
  ).toBeUndefined();
});

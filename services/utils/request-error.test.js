import { expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));

const { classifyRequestError, extractHttpStatusDetails } = await import('./request-error');

test('classifyRequestError follows cause chain timeout error codes', () => {
  const cause = Object.assign(new Error('socket timed out'), { code: 'ETIMEDOUT' });
  const error = new Error('Failed to get monitoring data', { cause });

  expect(classifyRequestError(error)).toBe('timeout');
});

test('classifyRequestError follows cause chain network reset error codes', () => {
  const cause = Object.assign(new Error('connection reset by peer'), { code: 'ECONNRESET' });
  const error = new Error('Failed to get preload data', { cause });

  expect(classifyRequestError(error)).toBe('network_reset');
});

test('extractHttpStatusDetails parses HTTP status code and message from error chains', () => {
  const cause = new Error('Upstream failed with 503 Service Unavailable');
  const error = new Error('Failed to fetch status page', { cause });

  expect(extractHttpStatusDetails(error)).toEqual({
    statusCode: 503,
    statusMessage: 'Service Unavailable',
  });
});

test('classifyRequestError maps HTTP status code ranges and ignores non-error status codes', () => {
  expect(classifyRequestError(new Error('Request failed with 404 Not Found'))).toBe('http_4xx');
  expect(classifyRequestError(new Error('Request failed with 503 Service Unavailable'))).toBe(
    'http_5xx'
  );
  expect(classifyRequestError(new Error('Redirected with 302 Found'))).toBe('unknown');
});

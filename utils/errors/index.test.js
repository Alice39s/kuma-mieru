import { expect, test } from 'bun:test';
import { ConfigError, getErrorLogDetails, getErrorMessage } from './index';

test('getErrorMessage returns Error messages', () => {
  expect(getErrorMessage(new Error('connection failed'))).toBe('connection failed');
  expect(getErrorMessage(new ConfigError('bad config'))).toBe('bad config');
});

test('getErrorMessage uses fallback for non-Error values', () => {
  expect(getErrorMessage('plain text')).toBe('Unknown error');
  expect(getErrorMessage({ message: 'object message' })).toBe('Unknown error');
  expect(getErrorMessage(null, 'fallback reason')).toBe('fallback reason');
  expect(getErrorMessage(undefined, 'Unknown error occurred')).toBe('Unknown error occurred');
});

test('getErrorLogDetails returns structured details for Error values', () => {
  const cause = new Error('root cause');
  const error = new Error('connection failed', { cause });

  expect(getErrorLogDetails(error)).toEqual({
    name: 'Error',
    message: 'connection failed',
    stack: error.stack,
    cause,
  });
});

test('getErrorLogDetails preserves non-Error values for diagnostics', () => {
  const diagnostic = { code: 'EUNKNOWN' };

  expect(getErrorLogDetails(diagnostic)).toBe(diagnostic);
  expect(getErrorLogDetails('plain text')).toBe('plain text');
});

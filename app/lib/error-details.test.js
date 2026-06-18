import { expect, test } from 'bun:test';
import { parseErrorDetails, shouldShowErrorPageDevDetails } from './error-details';

test('parseErrorDetails rejects malformed current-page status codes', () => {
  const parsed = parseErrorDetails(
    'CURRENT_PAGE_UNAVAILABLE::main::network_reset::500oops::NO_HTTP_RESPONSE::Connection reset'
  );

  expect(parsed.kind).toBe('current_unavailable');
  expect(parsed.statusCode).toBeUndefined();
  expect(parsed.statusMessage).toBe('NO_HTTP_RESPONSE');
});

test('parseErrorDetails preserves current-page diagnostics containing delimiters', () => {
  const parsed = parseErrorDetails(
    'CURRENT_PAGE_UNAVAILABLE::main::parse_error::502::Bad Gateway::Parser failed::unexpected token'
  );

  expect(parsed.kind).toBe('current_unavailable');
  expect(parsed.diagnostics).toBe(
    'Parser failed::unexpected token (page: main, reason: parse_error)'
  );
  expect(parsed.statusCode).toBe(502);
  expect(parsed.statusMessage).toBe('Bad Gateway');
});

test('parseErrorDetails rejects malformed all-pages status codes', () => {
  const parsed = parseErrorDetails('ALL_PAGES_UNAVAILABLE::404x::Not Found::All pages failed');

  expect(parsed.kind).toBe('all_unavailable');
  expect(parsed.statusCode).toBeUndefined();
  expect(parsed.statusMessage).toBe('Not Found');
});

test('parseErrorDetails preserves all-pages diagnostics containing delimiters', () => {
  const parsed = parseErrorDetails(
    'ALL_PAGES_UNAVAILABLE::503::Service Unavailable::primary failed::secondary failed'
  );

  expect(parsed.kind).toBe('all_unavailable');
  expect(parsed.diagnostics).toBe('primary failed::secondary failed');
  expect(parsed.statusCode).toBe(503);
  expect(parsed.statusMessage).toBe('Service Unavailable');
});

test('shouldShowErrorPageDevDetails accepts explicit public dev mode flags', () => {
  expect(
    shouldShowErrorPageDevDetails({
      publicDevMode: ' TRUE ',
      nodeEnv: 'production',
    })
  ).toBe(true);
});

test('shouldShowErrorPageDevDetails keeps malformed public dev mode flags disabled', () => {
  expect(
    shouldShowErrorPageDevDetails({
      publicDevMode: 'yes',
      nodeEnv: 'production',
    })
  ).toBe(false);
});

test('shouldShowErrorPageDevDetails enables details in development', () => {
  expect(
    shouldShowErrorPageDevDetails({
      publicDevMode: undefined,
      nodeEnv: 'development',
    })
  ).toBe(true);
});

import { expect, test } from 'bun:test';
import { decodeUnicodeEscapes } from './decoder';

test('decodeUnicodeEscapes decodes decimal and hex HTML entities outside the BMP', () => {
  expect(decodeUnicodeEscapes('Launch: &#128640; / &#x1F680;')).toBe('Launch: 🚀 / 🚀');
});

test('decodeUnicodeEscapes preserves nested non-string primitive values', () => {
  expect(
    decodeUnicodeEscapes({
      enabled: true,
      count: 2,
      empty: null,
      values: [false, 0, null, 'line\\nnext'],
    })
  ).toEqual({
    enabled: true,
    count: 2,
    empty: null,
    values: [false, 0, null, 'line\nnext'],
  });
});

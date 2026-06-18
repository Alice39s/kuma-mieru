import { expect, test } from 'bun:test';
import { decodeUnicodeEscapes } from './decoder';

test('decodeUnicodeEscapes decodes decimal and hex HTML entities outside the BMP', () => {
  expect(decodeUnicodeEscapes('Launch: &#128640; / &#x1F680;')).toBe('Launch: 🚀 / 🚀');
});

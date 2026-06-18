import { expect, test } from 'bun:test';
import { decodeHtmlEntityCodePoint, decodeHtmlEntities } from './html-entities';

test('decodeHtmlEntityCodePoint decodes decimal and hex code points', () => {
  expect(decodeHtmlEntityCodePoint('128640', 10)).toBe('\u{1f680}');
  expect(decodeHtmlEntityCodePoint('1F680', 16)).toBe('\u{1f680}');
});

test('decodeHtmlEntityCodePoint keeps invalid code points unavailable', () => {
  expect(decodeHtmlEntityCodePoint('999999999', 10)).toBeNull();
  expect(decodeHtmlEntityCodePoint('110000', 16)).toBeNull();
});

test('decodeHtmlEntities decodes named and numeric entities while preserving invalid entities', () => {
  expect(decodeHtmlEntities('&quot;Launch &#128640; &#x1F680; &#999999999;&quot;')).toBe(
    '"Launch \u{1f680} \u{1f680} &#999999999;"'
  );
});

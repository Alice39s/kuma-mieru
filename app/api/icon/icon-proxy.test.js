import { expect, test } from 'bun:test';
import {
  isProxyableIconContentType,
  normalizeIconValue,
  parseIconContentLength,
  resolveUpstreamIconUrl,
} from './icon-proxy';

test('normalizeIconValue trims and unwraps quoted icon values', () => {
  expect(normalizeIconValue('  "/upload/icon.png"  ')).toBe('/upload/icon.png');
  expect(normalizeIconValue("  '/upload/icon.png'  ")).toBe('/upload/icon.png');
  expect(normalizeIconValue('   ')).toBeNull();
  expect(normalizeIconValue(123)).toBeNull();
});

test('resolveUpstreamIconUrl only allows same-origin http icons', () => {
  expect(resolveUpstreamIconUrl('/upload/icon.png', 'https://status.example.com/status/main')).toBe(
    'https://status.example.com/status/main/upload/icon.png'
  );
  expect(
    resolveUpstreamIconUrl('https://status.example.com/logo.png', 'https://status.example.com')
  ).toBe('https://status.example.com/logo.png');
  expect(
    resolveUpstreamIconUrl('https://cdn.example.com/logo.png', 'https://status.example.com')
  ).toBeNull();
  expect(
    resolveUpstreamIconUrl('//cdn.example.com/logo.png', 'https://status.example.com')
  ).toBeNull();
  expect(
    resolveUpstreamIconUrl('data:image/png;base64,AA==', 'https://status.example.com')
  ).toBeNull();
});

test('resolveUpstreamIconUrl rejects malformed absolute icon URLs', () => {
  expect(resolveUpstreamIconUrl('https://%', 'https://status.example.com')).toBeNull();
});

test('resolveUpstreamIconUrl rejects empty or malformed base URLs', () => {
  expect(resolveUpstreamIconUrl('/upload/icon.png', '')).toBeNull();
  expect(resolveUpstreamIconUrl('/upload/icon.png', 'https://%')).toBeNull();
});

test('isProxyableIconContentType rejects upstream SVG icons', () => {
  expect(isProxyableIconContentType('image/png')).toBe(true);
  expect(isProxyableIconContentType('image/webp; charset=binary')).toBe(true);
  expect(isProxyableIconContentType('image/svg+xml')).toBe(false);
  expect(isProxyableIconContentType('text/html')).toBe(false);
});

test('parseIconContentLength accepts unsigned integer header values', () => {
  expect(parseIconContentLength('2048')).toBe(2048);
  expect(parseIconContentLength(' 2048 ')).toBe(2048);
});

test('parseIconContentLength ignores missing or malformed header values', () => {
  expect(parseIconContentLength(undefined)).toBeNull();
  expect(parseIconContentLength('')).toBeNull();
  expect(parseIconContentLength('12.5')).toBeNull();
  expect(parseIconContentLength('-1')).toBeNull();
  expect(parseIconContentLength('2MB')).toBeNull();
});

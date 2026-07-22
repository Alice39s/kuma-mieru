import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'bun:test';
import { getImageRemotePatterns } from './image-remote-patterns';

const createConfigDir = config => {
  const cwd = mkdtempSync(join(tmpdir(), 'kuma-mieru-images-'));
  const generatedDir = join(cwd, 'config', 'generated');
  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(join(generatedDir, 'image-domains.json'), JSON.stringify(config));
  return cwd;
};

test('getImageRemotePatterns uses generated allowlist by default', () => {
  const cwd = createConfigDir({
    patterns: [
      { hostname: 'status.example.com', protocols: ['https'] },
      { hostname: 'status.example.com', protocols: ['https', 'http'] },
      { hostname: '', protocols: ['https'] },
    ],
  });

  expect(getImageRemotePatterns({ cwd, env: {} })).toEqual([
    { hostname: 'status.example.com', pathname: '/**', protocol: 'https', search: '' },
    { hostname: 'status.example.com', pathname: '/**', protocol: 'http', search: '' },
  ]);
});

test('getImageRemotePatterns does not fall back to wildcard when generated config is missing', () => {
  expect(
    getImageRemotePatterns({ cwd: mkdtempSync(join(tmpdir(), 'kuma-mieru-images-')), env: {} })
  ).toEqual([]);
});

test('getImageRemotePatterns supports explicit wildcard escape hatch', () => {
  expect(
    getImageRemotePatterns({
      cwd: mkdtempSync(join(tmpdir(), 'kuma-mieru-images-')),
      env: { ALLOW_ANY_IMAGE_REMOTE_PATTERNS: ' TRUE ' },
    })
  ).toEqual([
    { hostname: '*', pathname: '/**', protocol: 'https', search: '' },
    { hostname: '*', pathname: '/**', protocol: 'http', search: '' },
  ]);
});

test('getImageRemotePatterns rejects malformed wildcard escape hatch values', () => {
  expect(() =>
    getImageRemotePatterns({
      cwd: mkdtempSync(join(tmpdir(), 'kuma-mieru-images-')),
      env: { ALLOW_ANY_IMAGE_REMOTE_PATTERNS: 'yes' },
    })
  ).toThrow();
});

test('getImageRemotePatterns ignores generated wildcard patterns without escape hatch', () => {
  const cwd = createConfigDir({
    patterns: [{ hostname: '*', protocols: ['https', 'http'] }],
    domains: ['*'],
  });

  expect(getImageRemotePatterns({ cwd, env: {} })).toEqual([]);
});

test('getImageRemotePatterns ignores unsupported generated protocols', () => {
  const cwd = createConfigDir({
    patterns: [
      { hostname: 'status.example.com', protocols: ['ftp', 'https'] },
      { hostname: 'assets.example.com', protocols: ['file'] },
    ],
  });

  expect(getImageRemotePatterns({ cwd, env: {} })).toEqual([
    { hostname: 'status.example.com', pathname: '/**', protocol: 'https', search: '' },
  ]);
});

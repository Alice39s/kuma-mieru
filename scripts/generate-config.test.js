import { expect, test } from 'bun:test';
import { DEFAULT_SITE_ICON, DEFAULT_SITE_META } from '../config/defaults';

test('generate-config can be imported without running the generator', async () => {
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  try {
    await import('./generate-config.ts');
  } finally {
    console.log = originalLog;
  }

  expect(logs.some(line => line.includes('[generate-config] [start]'))).toBe(false);
});

test('buildIconCandidates trims strings, removes duplicates, and appends the default icon', async () => {
  const { buildIconCandidates } = await import('./generate-config.ts');

  expect(
    buildIconCandidates(
      [' /upload/logo.png ', '', null, undefined, '/upload/logo.png', 123, DEFAULT_SITE_ICON],
      DEFAULT_SITE_ICON
    )
  ).toEqual(['/upload/logo.png', DEFAULT_SITE_ICON]);
});

test('createPlaceholderConfig returns a valid build-time placeholder config', async () => {
  const { createPlaceholderConfig } = await import('./generate-config.ts');

  expect(createPlaceholderConfig()).toEqual({
    baseUrl: 'https://example.kuma-mieru.invalid',
    pageId: 'default',
    pageIds: ['default'],
    pages: [
      {
        id: 'default',
        baseUrl: 'https://example.kuma-mieru.invalid',
        siteMeta: DEFAULT_SITE_META,
      },
    ],
    siteMeta: DEFAULT_SITE_META,
    isPlaceholder: true,
    isEditThisPage: false,
    isShowStarButton: true,
  });
});

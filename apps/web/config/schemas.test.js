import { expect, test } from 'bun:test';
import { safeParse, summarize } from 'valibot';
import { appearanceSchema, generatedConfigFileSchema, siteMetaSchema } from './schemas';

const siteMeta = {
  title: 'Kuma Mieru',
  description: 'Status page',
  icon: '/icon.svg',
  iconCandidates: ['/icon.svg'],
};

const generatedConfig = {
  baseUrl: 'https://status.example.com',
  pageId: 'demo',
  pageIds: ['demo'],
  pages: [{ id: 'demo', baseUrl: 'https://status.example.com', siteMeta }],
  siteMeta,
  isPlaceholder: false,
  isEditThisPage: false,
  isShowStarButton: true,
  appearance: {
    backgroundImage: '',
    glassCards: false,
    backgroundSource: 'custom',
    backgroundQuery: 'nature landscape',
    backgroundRefreshSeconds: 21600,
  },
};

const parseConfigFile = config => safeParse(generatedConfigFileSchema, JSON.stringify(config));

test('generatedConfigFileSchema parses a generated config file', () => {
  const result = parseConfigFile({ ...generatedConfig, unknownKey: true });

  expect(result.success).toBe(true);
  expect(result.output).toEqual(generatedConfig);
});

test('generatedConfigFileSchema reports the path of an invalid base URL', () => {
  const result = parseConfigFile({
    ...generatedConfig,
    pages: [{ ...generatedConfig.pages[0], baseUrl: 'not a url' }],
  });

  expect(result.success).toBe(false);
  expect(summarize(result.issues)).toContain('pages.0.baseUrl');
});

test('generatedConfigFileSchema requires at least one page id', () => {
  const result = parseConfigFile({ ...generatedConfig, pageIds: [] });

  expect(result.success).toBe(false);
  expect(summarize(result.issues)).toContain('pageIds');
});

test('generatedConfigFileSchema rejects malformed JSON', () => {
  expect(safeParse(generatedConfigFileSchema, '{"baseUrl":').success).toBe(false);
});

test('siteMetaSchema requires at least one icon candidate', () => {
  expect(safeParse(siteMetaSchema, { ...siteMeta, iconCandidates: [] }).success).toBe(false);
});

test('appearance defaults preserve the existing dashboard', () => {
  const { appearance, ...legacyConfig } = generatedConfig;
  expect(parseConfigFile(legacyConfig).output.appearance).toEqual(appearance);
});

test('appearance accepts remote images and local public paths', () => {
  for (const backgroundImage of [
    'https://images.example.com/photo.jpg',
    'http://localhost:3881/background.png',
    '/background.webp',
    '/images/my background (1).jpg',
  ]) {
    const result = safeParse(appearanceSchema, { backgroundImage, glassCards: true });
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ backgroundImage, glassCards: true });
  }
});

test('appearance rejects invalid URLs and non-HTTP protocols', () => {
  for (const backgroundImage of [
    'not a url',
    '//images.example.com/photo.jpg',
    '/\\images.example.com/photo.jpg',
    '/image\n.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'file:///image.jpg',
  ]) {
    expect(safeParse(appearanceSchema, { backgroundImage }).success).toBe(false);
  }
});

test('background sources and refresh intervals accept only documented options', () => {
  for (const backgroundSource of ['custom', 'unsplash', 'pexels']) {
    for (const backgroundRefreshSeconds of [0, 900, 21600, 86400]) {
      expect(
        safeParse(appearanceSchema, { backgroundSource, backgroundRefreshSeconds }).success
      ).toBe(true);
    }
  }
  for (const backgroundRefreshSeconds of [-1, 1, 899, 86401, 900.5]) {
    expect(safeParse(appearanceSchema, { backgroundRefreshSeconds }).success).toBe(false);
  }
  expect(safeParse(appearanceSchema, { backgroundSource: 'unconfigured-provider' }).success).toBe(
    false
  );
});

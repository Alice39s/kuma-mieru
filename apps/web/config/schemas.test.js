import { expect, test } from 'bun:test';
import { safeParse, summarize } from 'valibot';
import { generatedConfigFileSchema, siteMetaSchema } from './schemas';

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

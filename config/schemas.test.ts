import { describe, expect, test } from 'bun:test';
import { safeParse } from 'valibot';
import { generatedConfigSchema, siteMetaSchema } from './schemas';

const siteMeta = {
  title: 'Network status',
  description: '',
  icon: '/icon.svg',
  iconCandidates: ['/icon.svg'],
};
const config = {
  baseUrl: 'https://status.example.com',
  pageId: 'default',
  pageIds: ['default'],
  pages: [{ id: 'default', baseUrl: 'https://status.example.com', siteMeta }],
  siteMeta,
  isPlaceholder: false,
  isEditThisPage: false,
  isShowStarButton: true,
};

describe('generated configuration validation', () => {
  test('preserves valid output and strips extra properties', () => {
    const result = safeParse(generatedConfigSchema, { ...config, privateValue: 'discard' });
    expect(result.success).toBe(true);
    expect(result.output).toEqual(config);
  });

  test('accepts empty titles and descriptions but requires icon candidates', () => {
    expect(safeParse(siteMetaSchema, { ...siteMeta, title: '' }).success).toBe(true);
    expect(safeParse(siteMetaSchema, { ...siteMeta, iconCandidates: [] }).success).toBe(false);
  });

  test('requires at least one configured page and page id', () => {
    expect(safeParse(generatedConfigSchema, { ...config, pages: [] }).success).toBe(false);
    expect(safeParse(generatedConfigSchema, { ...config, pageIds: [] }).success).toBe(false);
  });

  test('trims URL whitespace without normalizing paths or adding slashes', () => {
    const result = safeParse(generatedConfigSchema, {
      ...config,
      baseUrl: ' https://example.com ',
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected a valid URL');
    expect(result.output.baseUrl).toBe('https://example.com');
  });

  test.each(['http://127.0.0.1:3001', 'https://[::1]:3001', 'https://example.com/kuma'])(
    'accepts upstream URL %s',
    baseUrl => {
      expect(safeParse(generatedConfigSchema, { ...config, baseUrl }).success).toBe(true);
    }
  );

  test.each(['', '/status/default', 'not a URL'])('rejects malformed upstream URL %s', baseUrl => {
    expect(safeParse(generatedConfigSchema, { ...config, baseUrl }).success).toBe(false);
  });
});

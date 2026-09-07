import { describe, expect, test } from 'bun:test';
import type { PreloadData } from '@/types/config';
import { extractPreloadData } from './json-processor';
import { resolvePreloadDataFromHtml } from './preload-data';

const preload = {
  config: {
    slug: 'default',
    title: 'Network \\u1234 &amp;',
    description: 'Status',
    theme: 'light',
    published: true,
    icon: '/icon.svg',
    showTags: true,
    customCSS: '',
    footerText: '',
    showPoweredBy: false,
    googleAnalyticsId: null,
    showCertificateExpiry: false,
  },
  publicGroupList: [],
  maintenanceList: [],
} satisfies PreloadData;

describe('preload parsing', () => {
  test('preserves literal escapes and entities in JSON string values', () => {
    expect(extractPreloadData(JSON.stringify(preload))).toEqual(preload);
  });

  test('parses legacy object literals without evaluating JavaScript', () => {
    expect(
      extractPreloadData(
        "window.preloadData = { config: { slug: 'default', title: 'Network', description: '', theme: 'light', published: true, }, publicGroupList: [], }; "
      ).config.title
    ).toBe('Network');
    expect(() => extractPreloadData('(() => ({config: {}, publicGroupList: []}))()')).toThrow(
      'All parsing methods failed'
    );
  });

  test('rejects missing required fields', () => {
    expect(() => extractPreloadData('{"config":{},"publicGroupList":[]}')).toThrow(
      'All parsing methods failed'
    );
  });

  test.each(['script', 'data-json', 'legacy'] as const)(
    'extracts %s HTML payload',
    async format => {
      const json = JSON.stringify(preload);
      const html =
        format === 'script'
          ? `<script id="preload-data">${json}</script>`
          : format === 'data-json'
            ? `<script id="preload-data" data-json='${json.replaceAll('&', '&amp;').replaceAll("'", '&#39;')}'></script>`
            : `<script>window.preloadData = ${json};</script>`;
      const result = await resolvePreloadDataFromHtml({
        html,
        baseUrl: 'https://example.com',
        pageId: 'default',
      });
      expect(result.data).toEqual(preload);
    }
  );

  test('retains API fallback when the HTML has no preload payload', async () => {
    let requested = '';
    const result = await resolvePreloadDataFromHtml({
      html: '<html><body>Status</body></html>',
      baseUrl: 'https://example.com/kuma',
      pageId: 'secondary',
      fetchFn: async url => {
        requested = url;
        return { ok: true, status: 200, statusText: 'OK', json: async () => preload };
      },
    });
    expect(requested).toBe('https://example.com/kuma/api/status-page/secondary');
    expect(result.source).toBe('api-fallback');
    expect(result.data).toEqual(preload);
  });
});

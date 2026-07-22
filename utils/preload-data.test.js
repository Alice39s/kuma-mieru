import * as cheerio from 'cheerio';
import { expect, test } from 'bun:test';
import {
  fetchPreloadDataFromApi,
  getPreloadPayload,
  resolvePreloadDataFromHtml,
} from './preload-data';

test('getPreloadPayload decodes data-json attributes parsed by Cheerio', () => {
  const $ = cheerio.load(
    '<script id="preload-data" data-json="{&quot;title&quot;:&quot;&#128640;&quot;}"></script>'
  );

  expect(getPreloadPayload($)).toEqual({
    payload: '{"title":"🚀"}',
    source: 'data-json',
  });
});

test('resolvePreloadDataFromHtml keeps invalid fast-path data-json numeric entities', async () => {
  const html = `
    <script
      id="preload-data"
      data-json="{&quot;config&quot;:{&quot;slug&quot;:&quot;status&quot;,&quot;title&quot;:&quot;&#128640; &#999999999;&quot;,&quot;description&quot;:&quot;Service status&quot;,&quot;icon&quot;:&quot;/icon.svg&quot;,&quot;theme&quot;:&quot;dark&quot;,&quot;published&quot;:true,&quot;showTags&quot;:true,&quot;customCSS&quot;:&quot;&quot;,&quot;footerText&quot;:&quot;&quot;,&quot;showPoweredBy&quot;:false,&quot;googleAnalyticsId&quot;:null,&quot;showCertificateExpiry&quot;:false},&quot;publicGroupList&quot;:[],&quot;maintenanceList&quot;:[]}"
    ></script>
  `;

  const resolved = await resolvePreloadDataFromHtml({
    html,
    baseUrl: 'https://status.example.com',
    pageId: 'main',
    logger: {},
  });

  expect(resolved.source).toBe('data-json');
  expect(resolved.data.config.title).toBe('🚀 &#999999999;');
});

test('fetchPreloadDataFromApi normalizes request headers with Web Headers semantics', async () => {
  let capturedHeaders;
  const fetchFn = async (_url, init) => {
    capturedHeaders = init.headers;

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        config: {
          slug: 'status',
          title: 'Status',
          description: 'Service status',
          icon: '/icon.svg',
          theme: 'dark',
          published: true,
          showTags: true,
          customCSS: '',
          footerText: '',
          showPoweredBy: false,
          googleAnalyticsId: null,
          showCertificateExpiry: false,
        },
        publicGroupList: [],
        maintenanceList: [],
      }),
    };
  };

  await fetchPreloadDataFromApi({
    baseUrl: 'https://status.example.com',
    pageId: 'main',
    fetchFn,
    requestInit: {
      headers: {
        'X-Retry-Count': 3,
        'X-Enabled': false,
        'X-Skip': undefined,
      },
    },
  });

  expect(capturedHeaders).toEqual({
    accept: 'application/json',
    'x-enabled': 'false',
    'x-retry-count': '3',
  });
});

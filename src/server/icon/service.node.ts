import assert from 'node:assert/strict';
import test from 'node:test';
import { createIconProxyService, resolveIconTarget } from './service.js';

test('resolves only explicit same-origin upstream icon targets', () => {
  assert.equal(
    resolveIconTarget({
      icon: '/assets/icon.png',
      sourceBaseUrl: 'https://status.example.com/status/',
    })?.toString(),
    'https://status.example.com/assets/icon.png'
  );
  assert.equal(
    resolveIconTarget({
      icon: '"brand/icon.webp"',
      sourceBaseUrl: 'https://status.example.com/base',
    })?.toString(),
    'https://status.example.com/base/brand/icon.webp'
  );
  for (const icon of [
    '/icon.svg',
    'data:image/png;base64,AA==',
    '//cdn.example.com/icon.png',
    'https://cdn.example.com/icon.png',
    'https://status.example.com/icon.png#fragment',
  ]) {
    assert.equal(resolveIconTarget({ icon, sourceBaseUrl: 'https://status.example.com' }), null);
  }
});

test('returns a bounded safe image with a locally derived ETag', async () => {
  const requests: Array<{ origin: string; url: string }> = [];
  const service = createIconProxyService({
    requesterForOrigin: origin => async url => {
      requests.push({ origin, url: url.toString() });
      return {
        status: 200,
        data: new Uint8Array([137, 80, 78, 71]),
        contentType: 'image/png',
        etag: '"untrusted-upstream-etag"',
        lastModified: null,
        finalUrl: url,
      };
    },
  });
  const result = await service.fetch({
    icon: '/brand.png',
    sourceBaseUrl: 'https://status.example.com',
  });
  assert.deepEqual(requests, [
    {
      origin: 'https://status.example.com',
      url: 'https://status.example.com/brand.png',
    },
  ]);
  assert.equal(result?.contentType, 'image/png');
  assert.deepEqual(result?.bytes, new Uint8Array([137, 80, 78, 71]));
  assert.notEqual(result?.etag, '"untrusted-upstream-etag"');
});

test('rejects a binary response that is not an allowed raster icon', async () => {
  const service = createIconProxyService({
    requesterForOrigin: () => async url => ({
      status: 200,
      data: new TextEncoder().encode('<svg/>'),
      contentType: 'image/svg+xml',
      etag: null,
      lastModified: null,
      finalUrl: url,
    }),
  });
  assert.equal(
    await service.fetch({
      icon: '/untrusted.svg',
      sourceBaseUrl: 'https://status.example.com',
    }),
    null
  );
});

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { createOgImageService } from './service.js';
import type { OgImageInput } from './types.js';

const input: OgImageInput = {
  pageId: 'public',
  pageSlug: 'main',
  title: '全球服务状态',
  description: 'Tokyo 東京 and Seoul 서울',
  status: 'operational',
  stale: false,
  view: 'overview',
  services: [{ name: 'API 服务', status: 'operational' }],
};

test('single-flights renders, caches successes and changes the key with content', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-og-cache-'));
  const fallbackPath = resolve(directory, 'fallback.png');
  await writeFile(fallbackPath, 'fallback');
  let calls = 0;
  const service = createOgImageService({
    fallbackPath,
    renderImage: async value => {
      calls += 1;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 5));
      return Buffer.from(value.title);
    },
  });
  try {
    const [first, concurrent] = await Promise.all([service.render(input), service.render(input)]);
    assert.equal(calls, 1);
    assert.equal(first.source, 'rendered');
    assert.equal(concurrent.etag, first.etag);
    const cached = await service.render(input);
    assert.equal(cached.source, 'memory');
    assert.equal(calls, 1);
    const changed = await service.render({ ...input, status: 'major_outage' });
    assert.equal(changed.source, 'rendered');
    assert.equal(calls, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('serves but does not permanently cache the static fallback', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-og-fallback-'));
  const fallbackPath = resolve(directory, 'fallback.png');
  await writeFile(fallbackPath, 'fallback-image');
  let calls = 0;
  const service = createOgImageService({
    fallbackPath,
    renderImage: async () => {
      calls += 1;
      if (calls === 1) throw new Error('renderer unavailable');
      return Buffer.from('rendered-image');
    },
  });
  try {
    const fallback = await service.render(input);
    assert.equal(fallback.source, 'fallback');
    assert.equal(fallback.bytes.toString(), 'fallback-image');
    const recovered = await service.render(input);
    assert.equal(recovered.source, 'rendered');
    assert.equal(recovered.bytes.toString(), 'rendered-image');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('loadsheds unique renders and aborts a render that exceeds its deadline', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-og-bounds-'));
  const fallbackPath = resolve(directory, 'fallback.png');
  await writeFile(fallbackPath, 'bounded-fallback');
  let release: (() => void) | undefined;
  const service = createOgImageService({
    fallbackPath,
    maximumConcurrentRenders: 1,
    renderTimeoutMs: 10,
    renderImage: async (_value, signal) =>
      new Promise<Buffer>((resolvePromise, rejectPromise) => {
        release = () => resolvePromise(Buffer.from('late-image'));
        signal?.addEventListener('abort', () => rejectPromise(signal.reason), { once: true });
      }),
  });
  try {
    const blocked = service.render(input);
    const loadshed = await service.render({ ...input, view: 'metrics' });
    assert.equal(loadshed.source, 'fallback');
    assert.equal(loadshed.bytes.toString(), 'bounded-fallback');
    const timedOut = await blocked;
    assert.equal(timedOut.source, 'fallback');
    release?.();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

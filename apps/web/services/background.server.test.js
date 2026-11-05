import { expect, mock, spyOn, test } from 'bun:test';
import { createBackgroundSource } from './background.server';

const unsplashPhoto = (id = 'first') => ({
  urls: { raw: `https://images.unsplash.com/${id}?ixid=required-tracking` },
  links: {
    html: `https://unsplash.com/photos/${id}`,
    download_location: `https://api.unsplash.com/photos/${id}/download?ixid=required-tracking`,
  },
  user: { name: 'Example Photographer', links: { html: 'https://unsplash.com/@example' } },
});

const options = {
  source: 'unsplash',
  query: 'alpine lake',
  refreshSeconds: 900,
  accessKey: 'private-test-key',
};

const json = value =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('Unsplash combines concurrent requests, caches the photo and tracks its selection', async () => {
  let now = 0;
  let selected = 'first';
  const fetcher = mock(async (url, init) => {
    expect(init.headers.Authorization).toBe('Client-ID private-test-key');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    if (String(url).includes('/download')) return json({ url: 'unused' });
    const endpoint = new URL(url);
    expect(endpoint.searchParams.get('orientation')).toBe('landscape');
    expect(endpoint.searchParams.get('query')).toBe('alpine lake');
    expect(endpoint.searchParams.get('content_filter')).toBe('high');
    expect(endpoint.href).not.toContain('private-test-key');
    return json(unsplashPhoto(selected));
  });
  const source = createBackgroundSource(options, fetcher, () => now);
  const results = await Promise.all(Array.from({ length: 20 }, () => source.getPhoto()));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(results.every(result => result.photo.url === results[0].photo.url)).toBe(true);
  expect(results[0].photo.url).toContain('ixid=required-tracking');
  expect(results[0].photo.url).toContain('w=1920');
  expect(results[0].photo.photographerUrl).toContain('utm_source=kuma_mieru');
  await source.getPhoto();
  expect(fetcher).toHaveBeenCalledTimes(2);
  now = 900001;
  selected = 'second';
  expect((await source.getPhoto()).photo.url).toContain('/second?');
  expect(fetcher).toHaveBeenCalledTimes(4);
});

test('a provider outage retains the previous photo and backs off before retrying', async () => {
  let now = 0;
  let unavailable = false;
  const fetcher = mock(async url => {
    if (unavailable) return new Response('', { status: 429 });
    return String(url).includes('/download') ? json({}) : json(unsplashPhoto());
  });
  const source = createBackgroundSource(options, fetcher, () => now);
  const first = await source.getPhoto();
  now = 900001;
  unavailable = true;
  const warning = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect((await source.getPhoto()).photo).toEqual(first.photo);
    expect((await source.getPhoto()).photo).toEqual(first.photo);
    expect(fetcher).toHaveBeenCalledTimes(3);
    now += 60001;
    unavailable = false;
    await source.getPhoto();
    expect(fetcher).toHaveBeenCalledTimes(5);
  } finally {
    warning.mockRestore();
  }
});

test('invalid provider image and download hosts fail before a credential can be forwarded', async () => {
  for (const field of ['image', 'download']) {
    const photo = unsplashPhoto();
    if (field === 'image') photo.urls.raw = 'https://attacker.example/photo.jpg';
    else photo.links.download_location = 'https://attacker.example/download';
    const fetcher = mock(async () => json(photo));
    const source = createBackgroundSource(options, fetcher);
    await expect(source.getPhoto()).rejects.toThrow('Expected an HTTPS URL');
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

test('Pexels uses its own authorization format and retains the photographer credit', async () => {
  const fetcher = mock(async (url, init) => {
    expect(new URL(url).origin).toBe('https://api.pexels.com');
    expect(new URL(url).searchParams.get('orientation')).toBe('landscape');
    expect(init.headers.Authorization).toBe('private-test-key');
    return json({
      photos: [
        {
          url: 'https://www.pexels.com/photo/example-1/',
          photographer: 'Example Artist',
          photographer_url: 'https://www.pexels.com/@example',
          src: { large2x: 'https://images.pexels.com/photos/1/photo.jpeg' },
        },
      ],
    });
  });
  const source = createBackgroundSource({ ...options, source: 'pexels' }, fetcher, () => 0);
  expect((await source.getPhoto()).photo).toEqual({
    source: 'pexels',
    url: 'https://images.pexels.com/photos/1/photo.jpeg',
    photographer: 'Example Artist',
    photographerUrl: 'https://www.pexels.com/@example',
    photoUrl: 'https://www.pexels.com/photo/example-1/',
  });
});

test('empty galleries and missing keys fail without publishing an invalid background', async () => {
  const fetcher = mock(async () => json({ photos: [] }));
  const empty = createBackgroundSource({ ...options, source: 'pexels' }, fetcher);
  await expect(empty.getPhoto()).rejects.toThrow();
  await expect(empty.getPhoto()).rejects.toThrow('retry is delayed');
  expect(fetcher).toHaveBeenCalledTimes(1);
  const missing = createBackgroundSource({ ...options, accessKey: '' }, fetcher);
  await expect(missing.getPhoto()).rejects.toThrow('Missing API key');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

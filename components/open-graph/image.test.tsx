import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { ImageResponse } from 'takumi-js/response';
import { OpenGraphImage } from './image';

test('renders a full-size PNG with the bundled multilingual font and logo', async () => {
  const logo = `data:image/svg+xml;base64,${(await readFile(new URL('../../public/icon.svg', import.meta.url))).toString('base64')}`;
  const font = await readFile(
    new URL('../../assets/og/NotoSansCJKsc-Regular.otf', import.meta.url)
  );
  const response = new ImageResponse(
    <OpenGraphImage
      logo={logo}
      data={{
        title: '全球网络 繁體中文 日本語 한국어 Русский',
        description: 'Regional network availability',
        pageTitle: 'Kuma Mieru',
        pageId: 'default',
        status: 'Operational',
        color: '#34d399',
        isAvailable: true,
        isMonitor: true,
        metrics: [{ label: 'UPTIME / 24H', value: '99.99%' }],
        checks: [
          { status: 1, ping: 42 },
          { status: 0, ping: null },
        ],
      }}
    />,
    { width: 1200, height: 630, fonts: [{ name: 'Noto Sans CJK SC', data: font }] }
  );
  await response.ready;
  const png = Buffer.from(await response.arrayBuffer());
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
  expect(png.length).toBeGreaterThan(10_000);
});

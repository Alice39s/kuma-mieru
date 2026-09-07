import { describe, expect, test } from 'bun:test';
import { buildStatusPageMetadata } from './site-metadata';

const config = {
  pageId: 'asia & pacific',
  siteMeta: {
    title: 'Regional Status',
    description: 'Network availability',
    icon: '/icon.svg',
    iconCandidates: ['/icon.svg'],
  },
};

describe('sharing metadata', () => {
  test('namespaces monitor images by status page without changing the document title', () => {
    const metadata = buildStatusPageMetadata(config, { monitorId: '42', monitorName: 'Tokyo' });
    expect(metadata.title).toBe('Regional Status');
    expect(metadata.openGraph).toMatchObject({
      title: 'Tokyo',
      images: [
        {
          url: '/og?pageId=asia+%26+pacific&monitorId=42',
          width: 1200,
          height: 630,
          alt: 'Tokyo - Regional Status',
          type: 'image/png',
        },
      ],
    });
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      images: metadata.openGraph?.images,
    });
  });

  test('gives the about page a distinct image', () => {
    expect(buildStatusPageMetadata(config, { isAbout: true }).openGraph).toMatchObject({
      title: 'About Kuma Mieru',
      images: [{ url: '/og?pageId=asia+%26+pacific&view=about' }],
    });
  });

  test('uses the default image when no status page is supplied', () => {
    expect(buildStatusPageMetadata().openGraph).toMatchObject({
      title: 'Kuma Mieru',
      images: [{ url: '/og' }],
    });
  });
});

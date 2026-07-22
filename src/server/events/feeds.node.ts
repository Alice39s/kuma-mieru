import assert from 'node:assert/strict';
import test from 'node:test';
import { feedEtag, renderAtom, renderRss } from './feeds.js';
import type { PublicationSnapshot } from './schemas.js';

const item: PublicationSnapshot = {
  publicationId: 'publication-1',
  eventId: 'incident-1',
  eventSequence: 1,
  type: 'incident',
  pageId: 'public',
  title: 'API <degraded>',
  state: 'investigating',
  body: 'Latency & errors are elevated.',
  affectedComponentIds: ['api'],
  occurredAt: '2026-07-22T18:00:00.000Z',
  recordedAt: '2026-07-22T18:00:01.000Z',
  publishedAt: '2026-07-22T18:00:02.000Z',
};

test('renders stable RSS and Atom feeds from published snapshots only', () => {
  const input = {
    baseUrl: 'https://status.example.com',
    pageSlug: 'main',
    pageTitle: 'Example status',
    items: [item],
  };
  const rss = renderRss(input);
  const atom = renderAtom(input);
  assert.equal(rss.includes('<rss version="2.0">'), true);
  assert.equal(rss.includes('API &lt;degraded&gt;'), true);
  assert.equal(rss.includes('Latency &amp; errors'), true);
  assert.equal(atom.includes('xmlns="http://www.w3.org/2005/Atom"'), true);
  assert.equal(atom.includes('urn:kuma-mieru:publication:publication-1'), true);
  assert.equal(feedEtag([item]), feedEtag([structuredClone(item)]));
  assert.notEqual(feedEtag([item]), feedEtag([{ ...item, state: 'resolved' }]));
});

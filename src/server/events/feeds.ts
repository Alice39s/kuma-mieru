import { createHash } from 'node:crypto';
import type { PublicationSnapshot } from './schemas.js';

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const absolute = (baseUrl: string, path: string) => new URL(path, baseUrl).toString();

const publicationPath = (pageSlug: string, item: PublicationSnapshot) => {
  const page = encodeURIComponent(pageSlug);
  const event = encodeURIComponent(item.eventId);
  if (item.type === 'maintenance') return `/status/${page}/maintenance/${event}/`;
  if (item.type === 'notice') return `/status/${page}/notices/#${event}`;
  return `/status/${page}/incidents/${event}/`;
};

export const feedEtag = (items: PublicationSnapshot[]) =>
  `"${createHash('sha256').update(JSON.stringify(items), 'utf8').digest('base64url')}"`;

export const renderRss = (input: {
  baseUrl: string;
  pageSlug: string;
  pageTitle: string;
  items: PublicationSnapshot[];
}) => {
  const pageUrl = absolute(input.baseUrl, `/status/${encodeURIComponent(input.pageSlug)}/`);
  const items = input.items
    .map(item => {
      const itemUrl = absolute(input.baseUrl, publicationPath(input.pageSlug, item));
      return `<item><guid isPermaLink="false">urn:kuma-mieru:publication:${escapeXml(item.publicationId)}</guid><title>${escapeXml(item.title)} — ${escapeXml(item.state)}</title><link>${escapeXml(itemUrl)}</link><description>${escapeXml(item.body)}</description><pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate></item>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(input.pageTitle)} updates</title><link>${escapeXml(pageUrl)}</link><description>Published status updates for ${escapeXml(input.pageTitle)}</description><lastBuildDate>${new Date(input.items[0]?.publishedAt ?? 0).toUTCString()}</lastBuildDate>${items}</channel></rss>`;
};

export const renderAtom = (input: {
  baseUrl: string;
  pageSlug: string;
  pageTitle: string;
  items: PublicationSnapshot[];
}) => {
  const pageUrl = absolute(input.baseUrl, `/status/${encodeURIComponent(input.pageSlug)}/`);
  const feedUrl = absolute(input.baseUrl, `/status/${encodeURIComponent(input.pageSlug)}/atom.xml`);
  const entries = input.items
    .map(item => {
      const itemUrl = absolute(input.baseUrl, publicationPath(input.pageSlug, item));
      return `<entry><id>urn:kuma-mieru:publication:${escapeXml(item.publicationId)}</id><title>${escapeXml(item.title)} — ${escapeXml(item.state)}</title><updated>${escapeXml(item.publishedAt)}</updated><published>${escapeXml(item.publishedAt)}</published><link href="${escapeXml(itemUrl)}"/><content type="text">${escapeXml(item.body)}</content></entry>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${escapeXml(pageUrl)}</id><title>${escapeXml(input.pageTitle)} updates</title><updated>${escapeXml(input.items[0]?.publishedAt ?? new Date(0).toISOString())}</updated><link rel="self" href="${escapeXml(feedUrl)}"/><link rel="alternate" href="${escapeXml(pageUrl)}"/>${entries}</feed>`;
};

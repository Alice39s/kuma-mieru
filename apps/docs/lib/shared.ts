import { requiredEnv } from './env';

/** The deploy prefix without a trailing slash, set by `site.config.ts` through `next.config.mjs`. */
export const basePath = requiredEnv('NEXT_PUBLIC_BASE_PATH', process.env.NEXT_PUBLIC_BASE_PATH);
export const siteOrigin = requiredEnv(
  'NEXT_PUBLIC_SITE_ORIGIN',
  process.env.NEXT_PUBLIC_SITE_ORIGIN
);
export const siteName = 'Kuma Mieru';

export const repository = {
  owner: 'Alice39s',
  name: 'kuma-mieru',
  branch: 'main',
  contentDir: 'apps/docs/content/docs',
} as const;
export const repositoryUrl = `https://github.com/${repository.owner}/${repository.name}`;

interface PageRef {
  slugs: string[];
  locale?: string;
}

function localePath(page: PageRef): string[] {
  if (page.locale === undefined) throw new Error(`Page /${page.slugs.join('/')} has no locale.`);
  return [page.locale, ...page.slugs];
}

/** The Markdown twin of a page, for "Copy Markdown" and LLM tools. Next.js does not prefix route handler URLs. */
export function pageMarkdownPath(page: PageRef): string {
  return `/md/${[...localePath(page), 'content.md'].join('/')}`;
}

/** The Open Graph image of a page, rendered at build time. */
export function pageImagePath(page: PageRef): string {
  return `/og/${[...localePath(page), 'image.png'].join('/')}`;
}

/**
 * Content links carry the public path (`/kuma-mieru/zh/…`) so the Markdown twins stay valid; router links take the
 * path without `basePath`, which Next.js adds back.
 */
export function routeHref(href: string): string {
  return basePath !== '' && href.startsWith(`${basePath}/`) ? href.slice(basePath.length) : href;
}

/** An absolute URL on the published site, for metadata and Markdown output. */
export function absoluteUrl(path: string): string {
  return `${siteOrigin}${basePath}${path}`;
}

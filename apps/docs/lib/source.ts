import { llms, loader } from 'fumadocs-core/source';
import { defineDocs } from 'fumadocs-mdx/macro';
import { i18n } from './i18n';
import { resolveIcon } from './icons';
import { absoluteUrl } from './shared';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    lastModified: true,
    postprocess: { includeProcessedMarkdown: true },
  },
});

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: '/',
  i18n,
  icon: resolveIcon,
});

export type DocsPage = (typeof source)['$inferPage'];

/**
 * The same pages with public URLs (origin and `basePath` included), for `llms.txt` and the Markdown twins that are
 * read outside the site.
 */
const publicSource = loader({
  source: docs.toFumadocsSource(),
  baseUrl: '/',
  i18n,
  url: (slugs, locale) =>
    absoluteUrl(`/${[locale, ...slugs].filter(segment => segment !== undefined).join('/')}`),
});

/**
 * Markdown for LLMs. `remarkContentLinks` has already turned links to other pages into public paths; the heading
 * carries the page's absolute URL.
 */
export const docsLlms = llms(publicSource, {
  renderPage: async page => `# ${page.data.title} (${page.url})

${await page.data.getText('processed')}`,
});

/** The public-URL twin of a site page, for the Markdown route. */
export function publicPage(page: DocsPage): (typeof publicSource)['$inferPage'] {
  const twin = publicSource.getPage(page.slugs, page.locale);
  if (!twin) throw new Error(`No public twin for ${page.url}`);
  return twin;
}

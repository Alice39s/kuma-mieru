import { existsSync } from 'node:fs';
import { posix, relative, resolve, sep } from 'node:path';
import { replaceSource } from 'fumadocs-core/mdx-plugins/stringifier';
import { getSlugs } from 'fumadocs-core/source';
import type { Root } from 'mdast';
import type {} from 'mdast-util-mdx-jsx';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';
import { basePath } from '../site.config.ts';
import { i18n } from './i18n.ts';

const contentDir = resolve('content/docs');
const CONTENT_LINK = /^(\.{1,2}\/[^#?]*\.mdx)(#[^?]*)?$/;
const LOCALE_SUFFIX = /\.([a-z]{2})\.mdx$/;

function localeOf(file: string): string {
  const suffix = LOCALE_SUFFIX.exec(file)?.[1];
  if (suffix === undefined) return i18n.defaultLanguage;
  if (!i18n.languages.some(language => language === suffix)) {
    throw new Error(`${file}: unknown locale "${suffix}"`);
  }
  return suffix;
}

/**
 * Rewrites links to content files (`../deploy/docker.mdx#compose`, also in `href` props such as `<Card>`) into the
 * public page URL in the language of the linking page, at compile time. Pages, their Markdown twins and
 * `llms-full.txt` then carry the same resolvable links, and a link to a missing page fails the build.
 */
export function remarkContentLinks() {
  return (tree: Root, file: VFile) => {
    const current = relative(contentDir, file.path).split(sep).join('/');
    // Files included from outside the content directory, such as design.md, link to no content pages.
    if (current.startsWith('..')) return;
    const locale = localeOf(current);
    const rewrite = (href: string): string => {
      const match = CONTENT_LINK.exec(href);
      if (!match) return href;
      const [, target, hash = ''] = match;
      if (target === undefined) return href;
      const path = posix.join(posix.dirname(current), target);
      if (!existsSync(resolve(contentDir, path))) {
        throw new Error(`${current}: ${href} points at no content file`);
      }
      return `${basePath}/${[locale, ...getSlugs(path)].join('/')}${hash}`;
    };
    // The Markdown for LLMs is copied from the authored source, so every rewrite is also applied to that output.
    visit(tree, node => {
      if (node.type === 'link') {
        const url = rewrite(node.url);
        if (url === node.url) return;
        node.url = url;
        const title = node.title ? ` "${node.title}"` : '';
        replaceSource(file, node, s => `[${s.inner(node)}](${url}${title})`);
        return;
      }
      if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return;
      for (const attribute of node.attributes) {
        if (
          attribute.type !== 'mdxJsxAttribute' ||
          attribute.name !== 'href' ||
          typeof attribute.value !== 'string'
        ) {
          continue;
        }
        const value = rewrite(attribute.value);
        if (value === attribute.value) continue;
        attribute.value = value;
        const from = attribute.position?.start.offset;
        const to = attribute.position?.end.offset;
        if (from === undefined || to === undefined) {
          throw new Error(
            `${current}: the href attribute of <${node.name ?? ''}> has no source position`
          );
        }
        replaceSource(file, node, s => {
          s.edit(from, to, `href="${value}"`);
          const range = s.range(node);
          if (range === undefined)
            throw new Error(`${current}: <${node.name ?? ''}> has no source range`);
          return s.slice(range.start, range.end);
        });
      }
    });
  };
}

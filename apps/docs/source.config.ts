import { remarkMdxFiles, remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';
import { remarkSteps } from 'fumadocs-core/mdx-plugins/remark-steps';
import { defineConfig } from 'fumadocs-mdx/config';
import { remarkContentLinks } from './lib/remark-content-links.ts';
import { remarkLabelColumns } from './lib/remark-label-columns.ts';

// Collections are declared with the macro API in lib/source.ts; this file holds the shared MDX pipeline.
export default defineConfig({
  mdxOptions: {
    // Remote images keep their natural size, so the build needs no network access.
    remarkImageOptions: { external: false },
    // GitHub's default themes keep comments at 4.5:1 on the code block surface in both themes.
    rehypeCodeOptions: { themes: { light: 'github-light-default', dark: 'github-dark-default' } },
    // ```npm code blocks become npm, pnpm, yarn and bun tabs; the reader's choice is kept across pages.
    remarkNpmOptions: { persist: { id: 'package-manager' } },
    // Content links are rewritten before Fumadocs' own plugins, so the processed Markdown for LLMs carries page URLs;
    // Mermaid, file trees and steps turn into components after them, so the Markdown keeps their source.
    remarkPlugins: defaults => [
      remarkContentLinks,
      remarkLabelColumns,
      ...defaults,
      remarkMdxMermaid,
      remarkMdxFiles,
      remarkSteps,
    ],
  },
});

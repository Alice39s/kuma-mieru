import { pluginShiki, type BundledShikiTheme } from '@expressive-code/plugin-shiki';
import type { ExpressiveCodeTheme } from 'expressive-code';
import rehypeExternalLinks from 'rehype-external-links';
import rehypeExpressiveCode from 'rehype-expressive-code';
import type { RehypeExpressiveCodeOptions } from 'rehype-expressive-code';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkSmartypants from 'remark-smartypants';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { useEffect, useState } from 'react';

const expressiveCodeOptions: RehypeExpressiveCodeOptions = {
  frames: false,
  textMarkers: false,
  shiki: false,
  plugins: [pluginShiki({ engine: 'javascript' })],
  themes: ['github-light', 'github-dark'] satisfies BundledShikiTheme[],
  useDarkModeMediaQuery: false,
  themeCssSelector: (theme: ExpressiveCodeTheme) => {
    return theme.type === 'dark' ? '.dark' : ':root';
  },
  styleOverrides: {
    borderRadius: '8px',
    borderWidth: '1px',
    borderColor: 'color-mix(in srgb, var(--ec-codeForeground) 18%, transparent)',
    codeFontFamily:
      'var(--font-mono), JetBrains Mono, SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace',
    codeFontSize: '14px',
    codeLineHeight: '1.6',
    codePaddingBlock: '16px',
    codePaddingInline: '16px',
  },
};

const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames || []), 'img'])],
  attributes: {
    ...defaultSchema.attributes,
    a: [...new Set([...(defaultSchema.attributes?.a || []), 'target', 'rel'])],
    img: [
      ...new Set([
        ...(defaultSchema.attributes?.img || []),
        'src',
        'alt',
        'title',
        'width',
        'height',
        'loading',
      ]),
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...new Set([...(defaultSchema.protocols?.href || []), 'http', 'https', 'mailto'])],
    src: [...new Set([...(defaultSchema.protocols?.src || []), 'http', 'https'])],
  },
};

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBreaks)
  .use(remarkSmartypants)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, markdownSanitizeSchema)
  .use(rehypeExternalLinks, {
    rel: ['noopener', 'noreferrer', 'nofollow'],
    target: '_blank',
  })
  .use(rehypeExpressiveCode, expressiveCodeOptions)
  .use(rehypeStringify);

const markdownRenderCache = new Map<string, Promise<string>>();

/**
 * Hook for rendering markdown content
 * @param content - markdown content to render
 * @returns rendered HTML string
 */
export function useMarkdown(content: string): string {
  const [html, setHtml] = useState('');

  useEffect(() => {
    let isCancelled = false;

    if (!content) {
      setHtml('');
      return () => {
        isCancelled = true;
      };
    }

    void renderMarkdown(content)
      .then(renderedHtml => {
        if (!isCancelled) {
          setHtml(renderedHtml);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setHtml('');
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [content]);

  return html;
}

/**
 * Utility function to render markdown content
 * @param content - markdown content to render
 * @returns rendered HTML string
 */
export async function renderMarkdown(content: string): Promise<string> {
  if (!content) return '';

  if (!markdownRenderCache.has(content)) {
    markdownRenderCache.set(
      content,
      markdownProcessor
        .process(content)
        .then(file => String(file).trim())
        .catch(() => '')
    );
  }

  return markdownRenderCache.get(content) as Promise<string>;
}

/**
 * Extract plain text from markdown content (for previews)
 * @param markdown - markdown content
 * @param maxLength - maximum length of extracted text
 * @returns plain text extracted from markdown
 */
export function extractPlainText(markdown: string, maxLength = 100): string {
  if (!markdown) return '';

  // Remove markdown syntax
  const noLinks = markdown.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const noImages = noLinks.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
  const noCode = noImages.replace(/```[\s\S]*?```/g, '');
  const noInlineCode = noCode.replace(/`[^`]+`/g, '');
  const noHeaders = noInlineCode.replace(/^#{1,6}\s+/gm, '');
  const noBold = noHeaders.replace(/\*\*([^*]+)\*\*/g, '$1');
  const noItalic = noBold.replace(/\*([^*]+)\*/g, '$1');
  const noStrike = noItalic.replace(/~~([^~]+)~~/g, '$1');

  // Clean up whitespace
  const cleaned = noStrike.replace(/\s+/g, ' ').trim();

  // Truncate if necessary
  if (cleaned.length > maxLength) {
    return `${cleaned.slice(0, maxLength)}...`;
  }

  return cleaned;
}

/**
 * Get common prose CSS classes for markdown content
 */
export const getMarkdownClasses = () => {
  return `prose prose-sm dark:prose-invert max-w-none w-full [&>:first-child]:mt-0 [&>:last-child]:mb-0
    prose-headings:text-gray-800 dark:prose-headings:text-gray-100
    prose-p:my-3 prose-p:leading-7 prose-p:text-gray-700 dark:prose-p:text-gray-300
    prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
    prose-ul:my-3 prose-ul:list-disc prose-ul:pl-6 prose-ol:my-3 prose-ol:list-decimal prose-ol:pl-6
    prose-li:my-1.5 prose-li:leading-7 prose-li:text-gray-700 dark:prose-li:text-gray-300
    prose-li:marker:text-gray-400 dark:prose-li:marker:text-gray-500
    prose-code:rounded prose-code:bg-black/5 dark:prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5
    prose-code:font-mono prose-code:text-[0.875rem] prose-code:before:content-none prose-code:after:content-none
    prose-pre:my-4 prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:border prose-pre:border-black/10
    dark:prose-pre:border-white/10 prose-pre:bg-white dark:prose-pre:bg-zinc-950 prose-pre:px-4 prose-pre:py-3
    prose-pre:font-mono prose-pre:text-[0.875rem] prose-pre:leading-6 prose-pre:text-zinc-800 dark:prose-pre:text-zinc-100
    prose-pre:shadow-xs
    [&_.expressive-code]:my-4 [&_.expressive-code]:overflow-hidden [&_.expressive-code]:rounded-lg
    [&_.expressive-code]:border [&_.expressive-code]:border-black/10 dark:[&_.expressive-code]:border-white/10
    [&_.expressive-code]:shadow-xs [&_.expressive-code_pre]:m-0 [&_.expressive-code_pre]:border-0
    [&_.expressive-code_pre]:rounded-none`;
};

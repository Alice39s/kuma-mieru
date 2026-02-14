import { useMemo } from 'react';
import sanitizeHtml from 'sanitize-html';

// Workaround for https://github.com/markdown-it/markdown-it/issues/1082
const MarkdownIt = require('markdown-it');

// 创建 markdown 渲染实例
const createMarkdownRenderer = () => {
  return MarkdownIt({
    html: true,
    linkify: true,
    breaks: true,
    typographer: true,
    listIndent: true,
  });
};

// 全局 markdown 渲染实例
const md = createMarkdownRenderer();

const markdownAllowedTags = [
  ...new Set([...sanitizeHtml.defaults.allowedTags, 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']),
];

const markdownAllowedAttributes = {
  ...sanitizeHtml.defaults.allowedAttributes,
  a: [...(sanitizeHtml.defaults.allowedAttributes.a || []), 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
};

const sanitizeMarkdownHtml = (html: string): string => {
  return sanitizeHtml(html, {
    allowedTags: markdownAllowedTags,
    allowedAttributes: markdownAllowedAttributes,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https'],
    },
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: 'noopener noreferrer nofollow',
        },
      }),
    },
  });
};

/**
 * Hook for rendering markdown content
 * @param content - markdown content to render
 * @returns rendered HTML string
 */
export function useMarkdown(content: string): string {
  return useMemo(() => {
    if (!content) return '';
    return sanitizeMarkdownHtml(md.render(content));
  }, [content]);
}

/**
 * Utility function to render markdown content
 * @param content - markdown content to render
 * @returns rendered HTML string
 */
export function renderMarkdown(content: string): string {
  if (!content) return '';
  return sanitizeMarkdownHtml(md.render(content));
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
  return `prose prose-sm dark:prose-invert w-full [&>:first-child]:mt-0 [&>:last-child]:mb-0
    prose-p:text-gray-600 dark:prose-p:text-gray-300
    prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
    prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
    prose-pre:bg-gray-100 dark:prose-pre:bg-gray-800 prose-pre:p-3
    prose-ul:list-disc prose-ul:pl-5 prose-ol:list-decimal prose-ol:pl-5
    prose-li:text-gray-600 dark:prose-li:text-gray-300
    prose-headings:text-gray-800 dark:prose-headings:text-gray-100
    prose-code:text-gray-800 dark:prose-code:text-gray-100
    prose-code:font-mono prose-code:text-sm`;
};

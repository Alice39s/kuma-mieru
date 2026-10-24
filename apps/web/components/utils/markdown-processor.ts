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

const initialSanitizeSchema = {
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

// 第二次 sanitize：用于约束 expressive-code 输出节点，避免其绕过前置净化。
const postExpressiveSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames || []), 'style'])],
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...new Set([
        ...(defaultSchema.attributes?.['*'] || []),
        'className',
        'style',
        'data*',
        'target',
        'rel',
      ]),
    ],
    a: [...new Set([...(defaultSchema.attributes?.a || []), 'target', 'rel'])],
    pre: [...new Set([...(defaultSchema.attributes?.pre || []), 'data*'])],
    code: [...new Set([...(defaultSchema.attributes?.code || []), 'data*'])],
    div: [...new Set([...(defaultSchema.attributes?.div || []), 'data*'])],
    span: [...new Set([...(defaultSchema.attributes?.span || []), 'data*'])],
    button: [...new Set([...(defaultSchema.attributes?.button || []), 'data*'])],
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
  .use(rehypeSanitize, initialSanitizeSchema)
  .use(rehypeExternalLinks, {
    rel: ['noopener', 'noreferrer', 'nofollow'],
    target: '_blank',
  })
  .use(rehypeExpressiveCode, expressiveCodeOptions)
  .use(rehypeSanitize, postExpressiveSanitizeSchema)
  .use(rehypeStringify);

export async function processMarkdown(content: string): Promise<string> {
  if (!content) return '';
  const file = await markdownProcessor.process(content);
  return String(file).trim();
}

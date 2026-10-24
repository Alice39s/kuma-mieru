import type { Root } from 'hast';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';
import { localeOf } from './remark-content-links.ts';

const codeWord: Record<string, { word: string; separator: string }> = {
  zh: { word: '代码', separator: '：' },
  en: { word: 'Code', separator: ': ' },
};

/**
 * Numbers the code blocks of a page. Each block scrolls in a focusable region, and the regions of one page need
 * distinct names; the name is the number, followed by the block's title when it has one.
 */
export function rehypeCodeLabels() {
  return (tree: Root, file: VFile) => {
    const locale = localeOf(file.path);
    const text = codeWord[locale];
    if (text === undefined) throw new Error(`${file.path}: no code block label for "${locale}"`);
    let count = 0;
    visit(tree, 'element', node => {
      if (node.tagName !== 'pre') return;
      count += 1;
      const title = node.properties.title;
      const suffix = typeof title === 'string' && title !== '' ? `${text.separator}${title}` : '';
      node.properties.dataLabel = `${text.word} ${count}${suffix}`;
    });
  };
}

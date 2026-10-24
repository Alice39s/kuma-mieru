import type { Nodes, Root, TableCell } from 'mdast';
import type {} from 'mdast-util-to-hast';
import { visit } from 'unist-util-visit';

/** The widest cell that still makes a label column: 8 CJK characters or 16 Latin ones. */
const LABEL_WIDTH = 16;
const WIDE = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;

function textOf(node: Nodes): string {
  if ('value' in node) return node.value;
  return 'children' in node ? node.children.map(child => textOf(child)).join('') : '';
}

function widthOf(node: Nodes): number {
  let units = 0;
  for (const char of textOf(node)) units += WIDE.test(char) ? 2 : 1;
  return units;
}

function keepOnOneLine(cell: TableCell): void {
  cell.data = {
    ...cell.data,
    hProperties: { ...cell.data?.hProperties, className: ['whitespace-nowrap'] },
  };
}

/**
 * Keeps table headers and short columns on one line. Automatic table layout gives the spare width to the column with
 * the longest text and shrinks the others to their narrowest word; Chinese breaks between any two characters, so a
 * two-character header would otherwise stack one character per line.
 */
export function remarkLabelColumns() {
  return (tree: Root) => {
    visit(tree, 'table', table => {
      const [head, ...body] = table.children;
      if (!head) return;
      head.children.forEach(keepOnOneLine);
      head.children.forEach((_, column) => {
        const cells = body.flatMap(row => row.children[column] ?? []);
        if (cells.every(cell => widthOf(cell) <= LABEL_WIDTH)) cells.forEach(keepOnOneLine);
      });
    });
  };
}

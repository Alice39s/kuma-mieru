import { default as AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const assertAccessible = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations
    .map(
      violation =>
        `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.nodes
          .map(node => node.target.join(' '))
          .join(', ')}`
    )
    .join('\n');
  expect(results.violations, summary).toEqual([]);
};

export const waitForFonts = (page: Page) => page.evaluate(() => document.fonts.ready);

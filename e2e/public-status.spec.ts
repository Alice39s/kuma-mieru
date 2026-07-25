import { default as AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { installPublicApi } from './fixtures/public-api';

const assertAccessible = async (page: Page) => {
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

const waitForFonts = (page: Page) => page.evaluate(() => document.fonts.ready);

test('renders a truthful public overview with a stable responsive reference', async ({ page }) => {
  await installPublicApi(page);
  await page.goto('/status/main/');

  await expect(page.getByRole('heading', { level: 1, name: 'Core services' })).toBeVisible();
  const overallStatus = page.getByRole('status', { name: 'Overall status' });
  await expect(overallStatus.getByText('All systems operational', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /API Gateway/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Public history' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notices' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Subscribe' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'RSS', exact: true })).toHaveAttribute(
    'href',
    '/status/main/rss.xml'
  );
  await expect(page.getByRole('link', { name: 'Atom', exact: true })).toHaveAttribute(
    'href',
    '/status/main/atom.xml'
  );

  await waitForFonts(page);
  await assertAccessible(page);
  await expect(page).toHaveScreenshot('public-overview.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    maxDiffPixelRatio: 0.001,
  });
});

test('keeps native publications, mirrored observations, and service evidence distinct', async ({
  page,
}) => {
  await installPublicApi(page);
  await page.goto('/status/main/history/');

  await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'API latency recovered' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mirrored events' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upstream network maintenance' })).toBeVisible();
  await expect(page.getByText('No secondary notifications')).toBeVisible();
  await assertAccessible(page);

  await page.goto('/status/main/notices/');
  await expect(page.getByRole('heading', { level: 1, name: 'Notices' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Regional routing advisory' })).toBeVisible();
  await expect(
    page.getByText(/without pretending that a monitor failed or changing component health/)
  ).toBeVisible();

  await page.goto('/status/main/service/api-gateway/');
  await expect(page.getByRole('heading', { level: 1, name: 'API Gateway' })).toBeVisible();
  await expect(page.getByText('42 ms', { exact: true })).toBeVisible();
  await expect(page.getByText('99.98%', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Source evidence' })).toBeVisible();
  await expect(page.getByText(/No latency series is available/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Service event history' })).toBeVisible();
  await assertAccessible(page);

  await page.goto('/status/main/incidents/incident-api-latency/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'API latency recovered' })
  ).toBeVisible();
  await expect(page.getByText('2 published entries')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'API latency under investigation' })
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'API latency review' })).toBeVisible();
});

test('does not collect email when delivery is disabled', async ({ page }) => {
  await installPublicApi(page);
  await page.goto('/status/main/subscribe/');

  await expect(page.getByRole('heading', { level: 1, name: 'Choose your channel' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Email is not active' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'RSS', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ATOM', exact: true })).toBeVisible();
  await assertAccessible(page);
});

test('supports an explicit double-opt-in request when email is active', async ({ page }) => {
  await installPublicApi(page, { emailSubscriptions: true });
  await page.goto('/status/main/subscribe/');

  await page.getByRole('textbox', { name: 'Email address' }).fill('visitor@example.com');
  await page.getByRole('checkbox', { name: 'API Gateway' }).check();
  await page.getByRole('button', { name: 'Send confirmation' }).click();

  await expect(page.getByRole('status')).toContainText('Check your inbox');
  await expect(page.getByText(/response is intentionally identical/)).toBeVisible();
  await assertAccessible(page);
});

test('refuses to present stale or partial evidence as healthy', async ({ page }) => {
  await installPublicApi(page, { partialCoverage: true, staleSource: true });
  await page.goto('/status/main/');

  const overallStatus = page.getByRole('status', { name: 'Overall status' });
  await expect(overallStatus.getByText('Status unknown', { exact: true })).toBeVisible();
  await expect(page.getByText('1 of 1 sources stale')).toBeVisible();
  await expect(overallStatus.getByText('All systems operational', { exact: true })).toHaveCount(0);
  await assertAccessible(page);
});

test('provides a keyboard-operable skip link and named landmarks', async ({ page }) => {
  await installPublicApi(page);
  await page.goto('/status/main/');
  await expect(page.getByRole('heading', { level: 1, name: 'Core services' })).toBeVisible();

  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to status content' });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
});

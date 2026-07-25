import { expect, test } from '@playwright/test';
import { assertAccessible, waitForFonts } from './fixtures/accessibility';
import { installAdminApi } from './fixtures/admin-api';

test('renders a stable responsive owner control plane', async ({ page }) => {
  await installAdminApi(page);
  await page.goto('/admin/');

  await expect(page.getByRole('heading', { level: 1, name: 'The system is quiet.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Control plane' })).toBeVisible();
  await expect(page.getByText('Configured sources').locator('..').getByText('1')).toBeVisible();
  await expect(page.getByText('Published pages').locator('..').getByText('1')).toBeVisible();

  await waitForFonts(page);
  await assertAccessible(page);
  await expect(page).toHaveScreenshot('admin-overview.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    maxDiffPixelRatio: 0.001,
  });
});

test('completes first-run owner setup and authenticated entry', async ({ page, isMobile }) => {
  const state = await installAdminApi(page, { setupRequired: true });
  await page.goto('/admin/');

  await expect(page.getByRole('heading', { level: 1, name: 'Establish the owner.' })).toBeVisible();
  await page.getByLabel('Setup token').fill('e2e-setup-token-0123456789abcdef');
  await page.getByLabel('Display name').fill('Reference Owner');
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Recovery password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create owner' }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Sign in' })).toBeVisible();
  expect(state.ownerSetup).toEqual({
    token: 'e2e-setup-token-0123456789abcdef',
    name: 'Reference Owner',
    email: 'owner@example.com',
    password: 'correct horse battery staple',
  });

  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Enter workbench' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'The system is quiet.' })).toBeVisible();
  if (isMobile) {
    await expect(page.locator('.workbench-mobile-signout')).toBeVisible();
  } else {
    await expect(page.getByText('owner', { exact: true })).toBeVisible();
  }
  await assertAccessible(page);
});

test('verifies and commits a source before composing its public page', async ({ page }) => {
  const state = await installAdminApi(page, { empty: true });
  await page.goto('/admin/');

  await page.getByRole('button', { name: 'Sources' }).click();
  await expect(page.getByRole('heading', { name: 'Connect a status source' })).toBeVisible();
  await page.getByLabel('Source ID').fill('primary');
  await page.getByLabel('Base URL').fill('https://status.example.com');
  await page.getByLabel('Page slugs / snapshot keys').fill('main');
  await page.getByRole('button', { name: 'Test connection' }).click();

  await expect(page.getByText('Validated at the trust boundary')).toBeVisible();
  await page.getByRole('button', { name: 'Commit new revision' }).click();
  await expect(page.getByRole('heading', { name: 'Committed sources' })).toBeVisible();
  await expect(page.getByText('primary', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByLabel('Internal page ID').fill('page-main');
  await page.getByLabel('Public slug').fill('main');
  await page.getByLabel('Public title').fill('Core services');
  await page.getByRole('button', { name: 'Commit page' }).click();

  await expect(page.getByRole('heading', { name: 'Published pages' })).toBeVisible();
  await expect(page.getByText('Core services', { exact: true })).toBeVisible();
  expect(state.sources).toHaveLength(1);
  expect(state.pages).toHaveLength(1);
  expect(state.revision).toBe(3);
  expect(state.mutationHeaders).toHaveLength(3);
  expect(state.mutationHeaders.every(headers => headers.csrf === 'e2e-csrf-token')).toBe(true);
  expect(state.mutationHeaders.every(headers => headers.origin === 'http://127.0.0.1:4173')).toBe(
    true
  );
  await assertAccessible(page);
});

test('keeps Viewer access read-only across configuration and event surfaces', async ({ page }) => {
  await installAdminApi(page, { role: 'viewer' });
  await page.goto('/admin/');

  await expect(page.getByRole('button', { name: 'Subscribers' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Sources' }).click();
  await expect(page.getByRole('heading', { name: 'Changes are unavailable.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connect a status source' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Pages' }).click();
  await expect(page.getByRole('heading', { name: 'Changes are unavailable.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Commit page' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Events' }).click();
  await expect(page.getByRole('heading', { name: 'Events are read-only.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create incident draft' })).toHaveCount(0);
  await assertAccessible(page);
});

test('provides keyboard access to control-plane content and mobile sign-out', async ({
  page,
  isMobile,
}) => {
  await installAdminApi(page);
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { level: 1, name: 'The system is quiet.' })).toBeVisible();

  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to control-plane content' });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#admin-main')).toBeFocused();

  const mobileSignOut = page.locator('.workbench-mobile-signout');
  if (isMobile) {
    await expect(mobileSignOut).toBeVisible();
  } else {
    await expect(mobileSignOut).toBeHidden();
  }
});

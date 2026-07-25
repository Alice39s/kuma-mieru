import { expect, test, type Page } from '@playwright/test';
import { assertAccessible, waitForFonts } from './fixtures/accessibility';
import { installAdminApi } from './fixtures/admin-api';

const dismissNotifications = async (page: Page) => {
  const notifications = page.locator('[data-sonner-toast]');
  while ((await notifications.count()) > 0) {
    const count = await notifications.count();
    await notifications.first().locator('[data-close-button]').click();
    await expect(notifications).toHaveCount(count - 1);
  }
};

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

test('lets an Editor create drafts without exposing publication or subscriber controls', async ({
  page,
}) => {
  const state = await installAdminApi(page, { role: 'editor' });
  await page.goto('/admin/');

  await expect(page.getByRole('button', { name: 'Subscribers' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Events' }).click();
  const incidentForm = page.getByRole('button', { name: 'Create incident draft' }).locator('..');
  await incidentForm.getByLabel('Public title').fill('API latency elevated');
  await incidentForm
    .getByLabel('Investigating update')
    .fill('We are investigating elevated latency in the inference API.');
  await incidentForm.getByLabel('Affected component IDs').fill('api, inference');
  await incidentForm.getByRole('button', { name: 'Create incident draft' }).click();

  await expect(page.getByRole('heading', { name: 'API latency elevated' })).toBeVisible();
  await expect(page.getByText('Draft access only.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review publication' })).toHaveCount(0);
  expect(state.incidents).toHaveLength(1);
  expect(state.publications).toHaveLength(0);
  await assertAccessible(page);
});

test('lets a Publisher review, publish, and retry without Owner-only controls', async ({
  page,
}) => {
  const state = await installAdminApi(page, {
    role: 'publisher',
    withDelivery: true,
    withIncident: true,
  });
  await page.goto('/admin/');

  await page.getByRole('button', { name: 'Sources' }).click();
  await expect(page.getByRole('heading', { name: 'Changes are unavailable.' })).toBeVisible();

  await page.getByRole('button', { name: 'Events' }).click();
  await page.getByRole('button', { name: 'Review publication' }).click();
  await expect(page.getByText('1 eligible recipients')).toBeVisible();
  await page.getByRole('button', { name: 'Publish v1' }).click();
  await expect
    .poll(() => state.publications)
    .toEqual([
      {
        eventId: 'incident-api-latency',
        expectedVersion: 1,
        notifySubscribers: false,
        reviewNonce: 'review-incident-api-latency-1',
      },
    ]);

  await page.getByRole('button', { name: 'Subscribers' }).click();
  await expect(page.getByText('Only an Owner can stage credentials')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify and activate' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Suppress' })).toHaveCount(0);
  await dismissNotifications(page);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('queued', { exact: true })).toBeVisible();
  expect(state.deliveries[0]?.attempts).toBe(4);
  await assertAccessible(page);
});

test('completes the Owner SMTP, retry, and suppression workflow', async ({ page }) => {
  const state = await installAdminApi(page, { withDelivery: true });
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Subscribers' }).click();

  await expect(page.getByRole('heading', { name: 'SMTP delivery is disabled.' })).toBeVisible();
  await page.getByLabel('SMTP host').fill('smtp.example.com');
  await page.getByLabel('Sender name').fill('Kuma Mieru Status');
  await page.getByLabel('Sender address').fill('status@example.com');
  await page.getByLabel('Username · optional').fill('mailer');
  await page.getByLabel('Password · optional').fill('reference-secret');
  await page.getByRole('button', { name: 'Verify and activate' }).click();

  await expect(page.getByRole('heading', { name: 'SMTP worker is active.' })).toBeVisible();
  expect(state.stagedCredentials).toBe(true);
  expect(state.smtp.configuration).toMatchObject({
    enabled: true,
    host: 'smtp.example.com',
    authenticated: true,
  });
  const testRecipient = page.getByLabel('Test recipient');
  await testRecipient.fill('owner@example.com');
  await expect(page.getByRole('button', { name: 'Send test' })).toBeEnabled();
  await testRecipient.press('Enter');
  await expect.poll(() => state.sentTestRecipients).toEqual(['owner@example.com']);
  await dismissNotifications(page);

  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('queued', { exact: true })).toBeVisible();
  await dismissNotifications(page);
  await page.getByRole('button', { name: 'Suppress' }).click();
  await page.getByRole('button', { name: 'Confirm suppress' }).click();
  await expect(page.getByText('suppressed', { exact: true })).toBeVisible();
  expect(state.subscribers[0]?.state).toBe('suppressed');
  expect(state.deliveries[0]?.subscriberState).toBe('suppressed');
  await assertAccessible(page);
});

test('renders a stable responsive delivery control plane', async ({ page }) => {
  await installAdminApi(page, { withDelivery: true });
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Subscribers' }).click();
  await expect(page.getByRole('heading', { name: 'SMTP delivery is disabled.' })).toBeVisible();

  await waitForFonts(page);
  await assertAccessible(page);
  await expect(page).toHaveScreenshot('admin-delivery.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    maxDiffPixelRatio: 0.001,
  });
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

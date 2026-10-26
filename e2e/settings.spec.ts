import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, resetDb, seedWords, shot } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test('settings live in one place, and Home is only about studying', async ({ page, request }, testInfo) => {
  await seedWords(request, { unknown: 14 });
  await page.goto('/');
  await expect(page.getByTestId('tile-review')).toBeVisible();
  for (const name of ['Audio', 'Furigana', 'Backup']) await expect(page.getByRole('region', { name })).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  for (const name of ['Pages', 'Audio', 'Furigana', 'Words', 'Backup']) await expect(page.getByRole('region', { name })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '50-settings');

  // Page size: chosen here, used by Pages.
  const sizes = page.getByRole('group', { name: 'Words per page' });
  await expect(sizes.getByRole('button', { name: '12' })).toHaveAttribute('aria-pressed', 'true');
  await sizes.getByRole('button', { name: '10' }).click();
  await expect(sizes.getByRole('button', { name: '10' })).toHaveAttribute('aria-pressed', 'true');

  // Audio toggles are remembered on this device.
  const audio = page.getByRole('region', { name: 'Audio' });
  await audio.getByLabel('Play the word when the answer is shown').uncheck();
  await audio.getByLabel(/Listening practice/).check();
  await page.reload();
  await expect(audio.getByLabel('Play the word when the answer is shown')).not.toBeChecked();
  await expect(audio.getByLabel(/Listening practice/)).toBeChecked();
  await expect(sizes.getByRole('button', { name: '10' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('link', { name: 'Pages', exact: true }).click();
  await expect(page.getByTestId('page-size')).toHaveText('10 words per page. Change it in Settings.');
  await expect(page.getByRole('group', { name: 'Words per page' })).toHaveCount(0);
  await shot(page, testInfo, '51-pages-size-from-settings');
  await page.getByRole('button', { name: 'Start a new page' }).click();
  await expect(page.getByRole('heading', { name: /^Page 1/ })).toBeVisible();
  await expect(page.locator('.page-cell')).toHaveCount(10);
});

test('import opens from Settings, and old links still work', async ({ page }, testInfo) => {
  await page.goto('/#/settings');
  await page.getByRole('region', { name: 'Words' }).getByRole('link', { name: 'Import from Renshuu' }).click();
  await expect(page).toHaveURL(/#\/settings\/import$/);
  await expect(page.getByRole('heading', { name: 'Import from Renshuu' })).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Main' });
  await expect(tabs.getByRole('link', { name: 'Settings' })).toHaveClass(/tabbar__item--active/);
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '52-settings-import');
  await page.getByRole('link', { name: '‹ Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  await page.goto('/#/import');
  await expect(page.getByRole('heading', { name: 'Import from Renshuu' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Settings' })).toHaveClass(/tabbar__item--active/);
});

test('Home warns when the nightly backup has stopped', async ({ page }, testInfo) => {
  const savedAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
  await page.route('/api/backup/nightly', (route) => route.fulfill({ json: { latest: { date: savedAt.slice(0, 10), savedAt, size: 1000 }, count: 5 } }));
  await page.goto('/');
  await expect(page.getByTestId('home-backup-warning')).toContainText('The nightly backup hasn’t run since');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '53-home-backup-warning');
  await page.getByRole('link', { name: 'download a backup' }).click();
  await expect(page).toHaveURL(/#\/settings\/backup$/);
  const backup = page.getByRole('region', { name: 'Backup' });
  await expect(backup.getByTestId('nightly-status')).toContainText('Newer runs have failed');
  await expect(backup.getByRole('button', { name: 'Download backup' })).toBeInViewport();

  // A fresh copy: no warning.
  await page.route('/api/backup/nightly', (route) => route.fulfill({ json: { latest: { date: 'x', savedAt: new Date().toISOString(), size: 1000 }, count: 5 } }));
  const nightly = page.waitForResponse('**/api/backup/nightly');
  await page.goto('/');
  await nightly;
  await expect(page.getByTestId('tile-review')).toBeVisible();
  await expect(page.getByTestId('home-backup-warning')).toHaveCount(0);
});

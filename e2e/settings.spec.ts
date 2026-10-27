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
  for (const name of ['New words', 'Pages', 'Audio', 'Furigana', 'Words', 'Grading', 'Backup']) await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
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
  await expect(page.getByTestId('page-size')).toHaveText('10 words per page, 12 new words a day (0 today). Change them in Settings.');
  await expect(page.getByRole('group', { name: 'Words per page' })).toHaveCount(0);
  await shot(page, testInfo, '51-pages-size-from-settings');
  await page.getByRole('button', { name: 'Start a new page' }).click();
  await expect(page.getByRole('heading', { name: /^Page 1/ })).toBeVisible();
  await expect(page.locator('.page-cell')).toHaveCount(10);
});

test('new words a day: set once for every device, and Pages asks past it', async ({ page, request }, testInfo) => {
  await seedWords(request, { unknown: 20 });
  await page.goto('/#/settings');
  const newWords = page.getByRole('region', { name: 'New words' });
  await expect(newWords.getByLabel('New words a day')).toHaveValue('12');
  await newWords.getByLabel('New words a day').selectOption('8');
  // Stored on the server: another device (a fresh request) sees it.
  await expect.poll(async () => (await (await request.get('/api/study')).json()).newWordsPerDay).toBe(8);
  await page.reload();
  await expect(newWords.getByLabel('New words a day')).toHaveValue('8');
  await shot(page, testInfo, '54-settings-new-words');

  await page.getByRole('link', { name: 'Pages', exact: true }).click();
  await expect(page.getByTestId('page-size')).toContainText('8 new words a day (0 today)');
  await page.getByRole('button', { name: 'Start a new page' }).click();
  await expect(page.locator('.page-cell')).toHaveCount(12);

  // 12 started today, over the 8: Pages asks before another.
  await page.getByRole('link', { name: 'Pages', exact: true }).click();
  await expect(page.getByText("You've started 12 new words today, your daily 8.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start a new page' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Pick the words yourself' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '55-pages-new-words-reached');
  await page.getByRole('button', { name: 'Start another page anyway' }).click();
  await page.getByRole('button', { name: 'Start a new page' }).click();
  await expect(page.getByRole('heading', { name: /^Page 2/ })).toBeVisible();
});

test('new words a day: Pages asks too when only words to check are left', async ({ page, request }) => {
  await seedWords(request, { unknown: 12 });
  expect((await request.put('/api/study', { data: { newWordsPerDay: 12 } })).ok()).toBeTruthy();
  expect((await request.post('/api/pages', { data: { size: 12 } })).ok()).toBeTruthy();
  await page.goto('/#/pages');
  // Exactly the 12: asks, and the link to pick words to check waits for an answer.
  await expect(page.getByText("You've started 12 new words today, your daily 12.")).toBeVisible();
  await expect(page.getByRole('link', { name: /pick words to check/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start another page anyway' }).click();
  await expect(page.getByRole('link', { name: /pick words to check/ })).toBeVisible();
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

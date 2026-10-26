import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BACKUP_FORMAT, BACKUP_SCHEMA } from '../shared/backup';
import { expectNoHorizontalScroll, graduatePage, resetDb, seedWords, shot } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetDb(request);
  await seedWords(request, { unknown: 4, known: 2 });
  await graduatePage(request, 4);
});

test('download a backup of everything, and see the nightly copy', async ({ page, request }, testInfo) => {
  await page.goto('/');
  const section = page.getByRole('region', { name: 'Backup' });
  await expect(section.getByTestId('nightly-status')).toHaveText('No nightly copy yet. The first one is saved tonight.');
  await expectNoHorizontalScroll(page);
  await section.scrollIntoViewIfNeeded();
  await shot(page, testInfo, 'backup-none-yet');

  const [download] = await Promise.all([page.waitForEvent('download'), section.getByRole('button', { name: 'Download backup' }).click()]);
  const backup = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(download.suggestedFilename()).toBe(`shiori-backup-${backup.exportedAt.slice(0, 10)}.json`);
  expect(backup).toMatchObject({ app: 'shiori', format: BACKUP_FORMAT, schema: BACKUP_SCHEMA });
  expect(backup.tables.words).toHaveLength(48);
  expect(backup.tables.pages).toHaveLength(1);
  expect(backup.tables.page_words).toHaveLength(4);
  // Two directions for each of the 6 sorted words.
  expect(backup.tables.cards).toHaveLength(12);
  expect(backup.tables.review_log.length).toBeGreaterThan(0);

  // What the cron does each night.
  expect((await request.post('/api/test/nightly')).ok()).toBeTruthy();
  await page.reload();
  await expect(section.getByTestId('nightly-status')).toContainText('Nightly copy saved');
  await expect(section.getByTestId('nightly-status')).toContainText('1 copy kept, the last 30 days at most.');
  await section.scrollIntoViewIfNeeded();
  await shot(page, testInfo, 'backup-nightly-saved');
});

test('an error from the server is reported, not saved as a backup', async ({ page }) => {
  await page.route('/api/backup', (route) => route.fulfill({ status: 500, json: { error: 'internal error' } }));
  let downloaded = false;
  page.on('download', () => (downloaded = true));
  await page.goto('/');
  const section = page.getByRole('region', { name: 'Backup' });
  await section.getByRole('button', { name: 'Download backup' }).click();
  await expect(section.getByText('Download failed: the server answered 500')).toBeVisible();

  // A sign-in page instead of the file, as when the Cloudflare Access session has run out.
  await page.route('/api/backup', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Sign in</html>' }));
  await section.getByRole('button', { name: 'Download backup' }).click();
  await expect(section.getByText('Download failed: not a JSON file')).toBeVisible();
  expect(downloaded).toBe(false);
});

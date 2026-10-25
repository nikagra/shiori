import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, FIXTURE, resetDb, shot } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test('import a Renshuu export, then sort words by recalling them', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByText('Welcome. Start by')).toBeVisible();
  await shot(page, testInfo, '01-home-empty');

  await page.getByRole('link', { name: 'importing a Renshuu list' }).click();
  await page.getByLabel('Export file').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: /Import renshuu_custom_sample/ }).click();
  await expect(page.getByTestId('import-result')).toContainText('Added 48 words');
  await expect(page.getByTestId('import-result')).toContainText('custom format');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '02-import-done');
  await expect(page.getByRole('link', { name: 'check which ones you already know' })).toBeVisible();

  // Importing the same file again adds nothing.
  await page.getByRole('button', { name: /Import renshuu_custom_sample/ }).click();
  await expect(page.getByTestId('import-result')).toContainText('Added 0 words, skipped 48');

  await page.getByRole('link', { name: 'Check', exact: true }).click();
  await expect(page.getByTestId('triage-remaining')).toHaveText('48 left');
  // Meaning stays hidden until you commit.
  await expect(page.getByRole('button', { name: 'I knew it' })).toHaveCount(0);
  await shot(page, testInfo, '03-check-prompt');

  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByTestId('triage-card').locator('.meaning__core')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '04-check-answer');
  await page.getByRole('button', { name: 'I knew it' }).click();
  await expect(page.getByTestId('triage-remaining')).toHaveText('47 left');

  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Show answer' }).click();
    await page.getByRole('button', { name: 'I didn’t know' }).click();
  }
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /Not worth learning/ }).click();
  await expect(page.getByTestId('triage-remaining')).toHaveText('43 left');

  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByTestId('tile-check')).toContainText('43');
  await expect(page.getByTestId('tile-inbox')).toContainText('3');
  // The known word's meaning→Japanese card is new and due today.
  await expect(page.getByTestId('tile-review')).toContainText('1');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '05-home-after-check');
});

test('reports lines it cannot read', async ({ page }) => {
  await page.goto('/#/import');
  await page.getByLabel('…or paste it').fill('犬/いぬ - dog\nthis line is broken\n猫/ねこ - cat');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('import-result')).toContainText('Added 2 words');
  await expect(page.getByText('1 lines could not be read')).toBeVisible();
});

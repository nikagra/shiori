import { expect, test, type APIRequestContext } from '@playwright/test';
import { expectNoHorizontalScroll, resetDb, seedWords, shot } from './helpers';

const SCHOOL_WORDS = ['学校/がっこう - school', '先生/せんせい - teacher', '宿題/しゅくだい - homework', '教室/きょうしつ - classroom', '試験/しけん - exam'].join('\n');

async function listId(request: APIRequestContext, name: string): Promise<number> {
  const lists = (await (await request.get(`/api/lists?dayStart=${new Date().toISOString()}&dayEnd=${new Date().toISOString()}`)).json()) as { id: number; name: string }[];
  return lists.find((l) => l.name === name)!.id;
}

/** Puts the school words in the inbox. Call it before seedWords, which leaves words to check that come first. */
async function seedSchool(request: APIRequestContext) {
  expect((await request.post('/api/import', { data: { text: SCHOOL_WORDS, listId: await listId(request, 'School') } })).ok()).toBeTruthy();
  const school = await listId(request, 'School');
  const triage = (await (await request.get('/api/triage')).json()).words as { id: number; listId: number }[];
  for (const w of triage.filter((w) => w.listId === school)) await request.post(`/api/triage/${w.id}`, { data: { result: 'unknown' } });
}

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test('manage lists: add, weight, weekly target, pause, focus, rename, merge, archive', async ({ page, request }, testInfo) => {
  await seedSchool(request);
  await seedWords(request, { unknown: 4 });
  await page.goto('/#/lists');
  await expect(page.getByRole('heading', { name: 'Lists', exact: true })).toBeVisible();
  const cards = page.getByTestId('list-card');
  await expect(cards).toHaveCount(4);
  const manga = page.getByRole('region', { name: 'Manga' });
  await expect(manga.getByTestId('list-counts')).toContainText('4 waiting');
  await expect(manga.getByText('Next page')).toBeVisible();

  // A name that's taken is refused and stays in the box to fix.
  await page.getByLabel('New list name').fill('manga');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('there is already a list with that name')).toBeVisible();
  await expect(page.getByLabel('New list name')).toHaveValue('manga');
  await page.getByLabel('New list name').fill('Yotsuba');
  await page.getByRole('button', { name: 'Add' }).click();
  const yotsuba = page.getByRole('region', { name: 'Yotsuba' });
  await expect(yotsuba).toBeVisible();
  await expect(yotsuba.getByTestId('list-counts')).toContainText('No words yet');

  // Weight, weekly target and pause are saved on the server.
  const school = page.getByRole('region', { name: 'School' });
  await school.getByRole('button', { name: 'High' }).click();
  await expect(school.getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'true');
  await school.getByRole('combobox').first().selectOption('1');
  await expect(school.getByTestId('list-counts')).toContainText('(target 1)');
  await page.getByRole('region', { name: 'Books' }).getByLabel(/Pause/).check();
  await expect(page.getByRole('region', { name: 'Books' }).getByText('Paused', { exact: true })).toBeVisible();
  await page.reload();
  await expect(school.getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'true');
  await expect(school.getByTestId('list-counts')).toContainText('(target 1)');
  await expect(page.getByRole('region', { name: 'Books' }).getByLabel(/Pause/)).toBeChecked();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '40-lists');

  // Focus one list; focusing another moves the focus.
  await school.getByText('Focus, rename, merge, archive').click();
  await school.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(school.getByText(/^Focus until/)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '41-list-more');
  await manga.getByText('Focus, rename, merge, archive').click();
  await manga.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(manga.getByText(/^Focus until/)).toBeVisible();
  await expect(school.getByText(/^Focus until/)).toHaveCount(0);
  await manga.getByRole('button', { name: 'End focus' }).click();
  await expect(manga.getByText(/^Focus until/)).toHaveCount(0);

  // Rename, then merge the renamed list into Manga.
  await yotsuba.getByText('Focus, rename, merge, archive').click();
  await yotsuba.getByLabel('Rename Yotsuba').fill('よつばと');
  await yotsuba.getByRole('button', { name: 'Rename' }).click();
  const renamed = page.getByRole('region', { name: 'よつばと' });
  await expect(renamed).toBeVisible();
  // An empty list is deleted rather than archived.
  await renamed.getByRole('button', { name: 'Delete' }).click();
  await expect(cards).toHaveCount(4);

  page.once('dialog', (d) => d.accept());
  await school.getByLabel('Merge School into').selectOption({ label: 'Other' });
  await school.getByRole('button', { name: 'Merge' }).click();
  await expect(cards).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Other' }).getByTestId('list-counts')).toContainText('5 waiting');

  // Archive: off the main list, back with Unarchive.
  const other = page.getByRole('region', { name: 'Other' });
  await other.getByText('Focus, rename, merge, archive').click();
  await other.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByTestId('archived-list')).toContainText('Other');
  await expect(cards).toHaveCount(2);
  await shot(page, testInfo, '42-lists-archived');
  await page.getByRole('button', { name: 'Unarchive' }).click();
  await expect(cards).toHaveCount(3);
});

test('a new page comes from one list, and "pick for me" follows the weekly target', async ({ page, request }, testInfo) => {
  await seedSchool(request);
  await seedWords(request, { unknown: 12 });
  await request.patch(`/api/lists/${await listId(request, 'School')}`, { data: { pagesPerWeek: 1 } });

  await page.goto('/#/pages');
  await expect(page.getByText('17 words waiting')).toBeVisible();
  const from = page.getByLabel('From list');
  await expect(from.locator('option').first()).toHaveText('Pick for me (School)');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '43-pages-from-list');
  await page.getByRole('button', { name: '10' }).click();
  await page.getByRole('button', { name: 'Start a new page' }).click();
  await expect(page.getByRole('heading', { name: 'Page 1 · School' })).toBeVisible();
  await expect(page.locator('.page-cell')).toHaveCount(5);

  // School met its target and has nothing left: Manga is next. Pick it by hand.
  await page.getByRole('link', { name: 'All pages' }).click();
  await expect(from.locator('option').first()).toHaveText('Pick for me (Manga)');
  await from.selectOption({ label: 'Manga: 12 waiting' });
  await page.getByRole('button', { name: 'Start a new page' }).click();
  await expect(page.getByRole('heading', { name: 'Page 2 · Manga' })).toBeVisible();
  await page.getByRole('link', { name: 'All pages' }).click();
  await expect(page.locator('.list-item').first()).toContainText('Manga · 10 words');
  await expect(page.locator('.list-item').nth(1)).toContainText('School · 5 words');
});

test('when every list with words waiting is paused, you pick one', async ({ page, request }) => {
  await seedWords(request, { unknown: 10 });
  await request.patch(`/api/lists/${await listId(request, 'Manga')}`, { data: { paused: true } });
  await page.goto('/#/pages');
  await expect(page.getByText('Every list with words waiting is paused')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start a new page' })).toBeDisabled();
  await page.getByLabel('From list').selectOption({ label: 'Manga: 10 waiting, paused' });
  await page.getByRole('button', { name: 'Start a new page' }).click();
  await expect(page.getByRole('heading', { name: 'Page 1 · Manga' })).toBeVisible();
});

test('import into a list you made', async ({ page, request }) => {
  await request.post('/api/lists', { data: { name: 'Marugoto A2' } });
  await page.goto('/#/import');
  await page.getByLabel('…or paste it').fill(SCHOOL_WORDS);
  await page.getByLabel('Which list is it?').selectOption({ label: 'Marugoto A2' });
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByTestId('import-result')).toContainText('Added 5 words');
  await page.goto('/#/lists');
  await expect(page.getByRole('region', { name: 'Marugoto A2' }).getByTestId('list-counts')).toContainText('5 to check');
});

test('check one list at a time, so a big import does not block the others', async ({ page, request }, testInfo) => {
  expect((await request.post('/api/import', { data: { text: SCHOOL_WORDS, listId: await listId(request, 'School') } })).ok()).toBeTruthy();
  await seedWords(request, { unknown: 0 });
  await page.goto('/#/lists');
  await page.getByRole('region', { name: 'School' }).getByRole('link', { name: '5 to check' }).click();
  await expect(page).toHaveURL(/#\/check\/\d+$/);
  await expect(page.getByTestId('triage-remaining')).toHaveText('5 left');
  await expect(page.getByLabel('List to check')).toHaveValue(String(await listId(request, 'School')));
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'check-one-list');

  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'Show answer' }).click();
    await page.getByRole('button', { name: 'I didn’t know' }).click();
  }
  await expect(page.getByText('Nothing left to check in School.')).toBeVisible();

  await page.getByLabel('List to check').selectOption({ index: 0 });
  await expect(page).toHaveURL(/#\/check$/);
  await expect(page.getByTestId('triage-remaining')).toHaveText('48 left');
});

import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, graduatePage, listId, resetDb, seedWords, shot } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

interface ApiWord {
  id: number;
  kana: string;
  kanji: string | null;
  status: string;
}

test('pick the words for a page, swap one close in meaning, then delete the page', async ({ page, request }, testInfo) => {
  await seedWords(request, { unknown: 6 });
  const manga = await listId(request, 'Manga');
  const words = (await (await request.get(`/api/lists/${manga}/words`)).json()) as ApiWord[];
  const waiting = words.filter((w) => w.status === 'inbox');
  const tasukeru = words.find((w) => w.kanji === '助ける')!;
  const zankoku = words.find((w) => w.kanji === '残酷')!;
  // A word that means nearly the same as 助ける (to save, to rescue).
  const twin = waiting.find((w) => w.id !== tasukeru.id && w.id !== zankoku.id)!;
  await request.patch(`/api/words/${twin.id}`, { data: { coreMeaning: 'to rescue' } });

  await page.goto('/#/pages');
  await page.getByRole('link', { name: 'Pick the words yourself' }).click();
  await expect(page.getByRole('heading', { name: 'Pick the words' })).toBeVisible();
  const rows = page.getByTestId('pick-row');
  // Waiting words first, then the ones still to check.
  await expect(rows).toHaveCount(words.length);
  await expect(rows.nth(6)).toContainText('To check');

  // Search in romaji and by meaning, and pick in order.
  const search = page.getByLabel('Search Manga');
  await search.fill('zankoku');
  await rows.first().click();
  await search.fill('rescue');
  await rows.filter({ hasText: '助ける' }).click();
  await rows.filter({ hasText: 'to rescue' }).filter({ hasNotText: '助ける' }).click();
  await search.fill('');
  await expect(page.getByTestId('picked-count')).toContainText('3 of 12 picked');
  await expect(page.getByTestId('picked-count')).toContainText('1 pair close in meaning');
  await expect(page.getByTestId('similar')).toContainText('助ける');
  await expect(page.getByRole('list', { name: 'Picked words' }).getByRole('button')).toHaveCount(3);
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '70-pick-words');

  // A tap on a picked chip takes it off; picking again puts it last.
  await page.getByRole('button', { name: 'Take 残酷 off' }).click();
  await expect(page.getByTestId('picked-count')).toContainText('2 of 12 picked');
  await rows.filter({ hasText: '残酷' }).click();
  await page.getByRole('button', { name: 'Start the page' }).click();

  await expect(page.getByRole('heading', { name: /Page 1/ })).toBeVisible();
  const cells = page.locator('.page-cell');
  await expect(cells).toHaveCount(3);
  await expect(cells.nth(0)).toContainText('助ける');
  await expect(cells.nth(2)).toContainText('残酷');
  await expect(page.getByTestId('similar')).toBeVisible();
  await shot(page, testInfo, '71-page-similar');

  // Swap the near twin for the next waiting word.
  await page.getByRole('button', { name: 'Change words' }).click();
  const editor = page.getByRole('region', { name: 'Change words' });
  const pageWords = editor.getByTestId('page-word');
  await pageWords.filter({ hasText: 'to rescue' }).filter({ hasNotText: '助ける' }).getByRole('button').first().click();
  const change = editor.getByRole('group', { name: /^Change / });
  await expect(change.getByRole('button', { name: /Swap for the next waiting word/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '72-change-word');
  await change.getByRole('button', { name: /Swap for the next waiting word/ }).click();
  await expect(editor.getByText(/^Swapped .* back to waiting\.$/)).toBeVisible();
  await expect(page.getByTestId('similar')).toHaveCount(0);
  await expect(cells).toHaveCount(3);

  // Take 残酷 off and set it aside, then add a word you pick.
  await pageWords.filter({ hasText: '残酷' }).getByRole('button').first().click();
  await change.getByLabel(/Set 残酷 aside/).check();
  await change.getByRole('button', { name: 'Take it off without a replacement' }).click();
  await expect(editor.getByText('Took 残酷 off the page; it is set aside.')).toBeVisible();
  await expect(cells).toHaveCount(2);
  await editor.getByRole('button', { name: 'Add a word (2 of 12)' }).click();
  await editor.getByLabel('Search Manga').fill('mishiranu');
  await editor.getByTestId('pick-row').first().click();
  await expect(editor.getByText('Added 見知らぬ.')).toBeVisible();
  await expect(cells.nth(2)).toContainText('見知らぬ');
  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Start step 1' })).toBeVisible();

  const pageId = Number(page.url().split('/').pop());
  const after = await (await request.get(`/api/lists/${manga}/words`)).json() as ApiWord[];
  expect(after.find((w) => w.id === zankoku.id)!.status).toBe('ignored');
  expect(after.find((w) => w.id === twin.id)!.status).toBe('inbox');

  // Delete it: its words wait for a page again.
  const onPage = (await (await request.get(`/api/pages/${pageId}`)).json()).words as ApiWord[];
  let asked = '';
  page.once('dialog', (d) => {
    asked = d.message();
    d.accept();
  });
  await page.getByRole('button', { name: 'Delete this page' }).click();
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible();
  expect(asked).toContain('Its 3 words go back to waiting');
  await expect(page.getByText('In progress')).toHaveCount(0);
  expect((await request.get(`/api/pages/${pageId}`)).status()).toBe(404);
  const afterDelete = (await (await request.get(`/api/lists/${manga}/words`)).json()) as ApiWord[];
  for (const w of onPage) expect(afterDelete.find((x) => x.id === w.id)!.status).toBe('inbox');
});

test('a learned page can be deleted and its words stay in review', async ({ page, request }) => {
  await seedWords(request, { unknown: 2 });
  const learned = await graduatePage(request, 2);
  await page.goto(`/#/pages/${learned.id}`);
  await expect(page.getByTestId('page-learned')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change words' })).toHaveCount(0);
  let asked = '';
  page.once('dialog', (d) => {
    asked = d.message();
    d.accept();
  });
  await page.getByRole('button', { name: 'Delete this page' }).click();
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible();
  expect(asked).toContain('stay in review');
  const manga = await listId(request, 'Manga');
  const words = (await (await request.get(`/api/lists/${manga}/words`)).json()) as (ApiWord & { hasCards: boolean })[];
  for (const w of learned.words) expect(words.find((x) => x.id === w.id)).toMatchObject({ status: 'graduated', hasCards: true });
});

import { expect, test, type APIRequestContext } from '@playwright/test';
import { expectNoHorizontalScroll, graduatePage, resetDb, seedWords, shot } from './helpers';

async function listId(request: APIRequestContext, name: string): Promise<number> {
  const lists = (await (await request.get(`/api/lists?dayStart=${new Date().toISOString()}&dayEnd=${new Date().toISOString()}`)).json()) as { id: number; name: string }[];
  return lists.find((l) => l.name === name)!.id;
}

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test("a list's words: search, filter, edit, move, set aside, check again, delete", async ({ page, request }, testInfo) => {
  // 2 known, 4 waiting, then a page of 2 learned from those: the rest of the
  // fixture is still to check.
  await seedWords(request, { known: 2, unknown: 4 });
  await graduatePage(request, 2);
  const manga = await listId(request, 'Manga');
  const words = (await (await request.get(`/api/lists/${manga}/words`)).json()) as { id: number; kana: string; kanji: string | null; status: string; page: unknown }[];
  const known = words.find((w) => w.status === 'graduated' && !w.page)!;

  await page.goto('/#/lists');
  await page.getByRole('region', { name: 'Manga' }).getByRole('link', { name: /See all \d+ words/ }).click();
  await expect(page.getByRole('heading', { name: 'Manga' })).toBeVisible();
  await expect(page.getByTestId('word-counts')).toContainText('2 waiting · 4 learning');
  const rows = page.getByTestId('word-row');
  await expect(rows).toHaveCount(words.length);

  // Filters by state, and a search in romaji finds the kana.
  await page.getByRole('button', { name: /^Waiting/ }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: /^Learning/ }).click();
  await expect(rows).toHaveCount(6);
  await page.getByRole('button', { name: /^All/ }).click();
  await expect(rows).toHaveCount(words.length);
  const search = page.getByLabel('Search Manga');
  await search.fill('zankoku');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('残酷');
  await search.fill('cruel');
  await expect(rows.first()).toContainText('残酷');
  await search.fill('残');
  await expect(rows.first()).toContainText('残酷');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '60-list-words');

  // Edit a word: the kana box turns romaji into kana, as in review.
  await search.fill('');
  const row = rows.filter({ hasText: known.kanji ?? known.kana }).first();
  await row.getByRole('button', { name: new RegExp(known.kana) }).click();
  const editor = row.getByRole('group', { name: /^Edit/ });
  await expect(editor.getByTestId('word-state')).toContainText('Learning');
  await expect(editor.getByTestId('word-state')).toContainText('next review');
  await editor.getByLabel('Meaning').fill('a meaning I wrote');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();
  await expect(row).toContainText('a meaning I wrote');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '61-word-edit');

  // Checked by mistake: check it again, and it's back in the check pass.
  await editor.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByText('will be checked again')).toBeVisible();
  await expect(row.getByText('To check')).toBeVisible();

  // Set aside, then delete it.
  await row.getByRole('button', { name: 'Set aside' }).click();
  await expect(row.getByText('Set aside', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Set aside \d/ }).click();
  await expect(rows).toHaveCount(1);
  page.once('dialog', (d) => d.accept());
  await rows.first().getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(/^Deleted /)).toBeVisible();
  await expect(rows).toHaveCount(0);
  await page.getByRole('button', { name: /^All/ }).click();
  await expect(rows).toHaveCount(words.length - 1);

  // Move a waiting word to School.
  await page.getByRole('button', { name: /^Waiting/ }).click();
  const waiting = rows.first();
  const moved = (await waiting.locator('.word-row__written').textContent())!;
  await waiting.locator('.word-row__head').click();
  await waiting.getByRole('combobox', { name: /^Move/ }).selectOption({ label: 'School' });
  await waiting.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByText(`Moved ${moved} to School.`)).toBeVisible();
  await expect(rows).toHaveCount(1);
  await page.goto('/#/lists');
  await page.getByRole('region', { name: 'School' }).getByRole('link', { name: 'See the word' }).click();
  await expect(page.getByTestId('word-row')).toHaveCount(1);
  await expect(page.getByTestId('word-row')).toContainText(moved);
});

test('a word on an unfinished page can be edited but stays on the page', async ({ page, request }) => {
  await seedWords(request, { unknown: 2 });
  const created = (await (await request.post('/api/pages', { data: { size: 2 } })).json()) as { id: number; number: number; words: { kana: string; kanji: string | null }[] };
  await page.goto(`/#/lists/${await listId(request, 'Manga')}`);
  await page.getByRole('button', { name: /^On a page/ }).click();
  const row = page.getByTestId('word-row').first();
  await row.locator('.word-row__head').click();
  await expect(row.getByTestId('word-state')).toContainText(`On page ${created.number}`);
  await expect(row.getByText('Moving, setting aside and deleting wait until the page is learned')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  // A duplicate of another word is refused with the reason.
  const other = created.words[1];
  await row.getByLabel('Kanji').fill(other.kanji ?? '');
  await row.getByLabel('Kana').fill(other.kana);
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('you already have a word with that kanji and kana')).toBeVisible();
});

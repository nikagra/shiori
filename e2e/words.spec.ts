import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, listId, graduatePage, resetDb, seedWords, shot } from './helpers';

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
  await expect(page.getByTestId('word-counts')).toContainText('2 waiting · 4 learned');
  const rows = page.getByTestId('word-row');
  await expect(rows).toHaveCount(words.length);

  // Filters by state, and a search in romaji finds the kana.
  await page.getByRole('button', { name: /^Waiting/ }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: /^Learned/ }).click();
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

  // Edit a word's meaning.
  await search.fill('');
  const row = rows.filter({ hasText: known.kanji ?? known.kana }).first();
  await row.getByRole('button', { name: new RegExp(known.kana) }).click();
  const editor = row.getByRole('group', { name: /^Edit/ });
  await expect(editor.getByTestId('word-state')).toContainText('Learned');
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

  // Romaji typed in the kana box turns into kana, a final n into ん; the word
  // stays on its page.
  await row.getByLabel('Kanji').fill('本当');
  await row.getByLabel('Kana').fill('');
  await row.getByLabel('Kana').pressSequentially('hontou');
  await expect(row.getByLabel('Kana')).toHaveValue('ほんとう');
  await row.getByLabel('Kana').fill('');
  await row.getByLabel('Kana').pressSequentially('hon');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved 本当.')).toBeVisible();
  await expect(row).toContainText('ほん');
  await expect(row.getByTestId('word-state')).toContainText(`On page ${created.number}`);
  const after = (await (await request.get(`/api/pages/${created.id}`)).json()) as { words: { kana: string; kanji: string | null }[] };
  expect(after.words.map((w) => w.kanji)).toContain('本当');
  expect(after.words.find((w) => w.kanji === '本当')!.kana).toBe('ほん');
});

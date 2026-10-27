import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, FIXTURE, listId, resetDb, shot } from './helpers';
import { readFileSync } from 'node:fs';

// The end-to-end dictionary is the sample in test/fixtures/dict_sample.json
// (e2e/prepare.mjs loads it): the Renshuu sample's words and a few more.

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test('add a word from the dictionary: search in romaji, English or kana, then add it to a list', async ({ page, request }, testInfo) => {
  const manga = await listId(request, 'Manga');
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Add a word from the dictionary' }).click();
  await expect(page.getByRole('heading', { name: 'Add a word' })).toBeVisible();

  const search = page.getByLabel('Search the dictionary');
  const rows = page.getByTestId('dict-row');
  await search.fill('taberu');
  await expect(rows.first()).toContainText('食べる');
  await expect(rows.first()).toContainText('to eat');
  await search.fill('hibernation');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('冬眠');
  await search.fill('たべ');
  await expect(rows.first()).toContainText('食べる');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '80-dict-search');

  // Open it: every sense, and the meaning to learn, which you can change.
  await rows.first().getByRole('button', { name: /食べる/ }).click();
  await expect(rows.first().getByText('Ichidan verb · transitive').first()).toBeVisible();
  await expect(rows.first().getByLabel('Meaning to learn')).toHaveValue('to eat');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '81-dict-entry');
  await rows.first().getByRole('button', { name: 'Add to Manga' }).click();
  await expect(page.getByText('Added 食べる to Manga. It waits for a page.')).toBeVisible();
  await expect(rows.first()).toContainText('in Manga');

  // A word usually written in kana is added in kana.
  await search.fill('chick');
  const hiyoko = rows.filter({ hasText: 'ひよこ' }).first();
  await hiyoko.getByRole('button').first().click();
  await expect(hiyoko.getByLabel(/Learn it in kana only/)).toBeChecked();
  await hiyoko.getByLabel('Meaning to learn').fill('chick');
  await hiyoko.getByRole('button', { name: 'Add to Manga' }).click();
  await expect(page.getByText('Added ひよこ to Manga.')).toBeVisible();

  // Both wait for a page in Manga, linked to their entries.
  const words = (await (await request.get(`/api/lists/${manga}/words`)).json()) as { kana: string; kanji: string | null; status: string; dict: string; coreMeaning: string }[];
  expect(words.map((w) => [w.kanji, w.kana, w.status, w.dict, w.coreMeaning])).toEqual([
    ['食べる', 'たべる', 'inbox', 'linked', 'to eat'],
    [null, 'ひよこ', 'inbox', 'linked', 'chick'],
  ]);

  // From a list, the word goes into that list.
  await page.goto(`/#/lists/${manga}`);
  await page.getByRole('link', { name: 'Add a word' }).click();
  await expect(page.getByRole('combobox', { name: 'To list' })).toHaveValue(String(manga));
});

test('imported words are looked up: per-kanji furigana, a flag in the check pass, and picking another entry', async ({ page, request }, testInfo) => {
  // Through the import screen, which looks the new words up.
  await page.goto('/#/settings/import');
  await page.getByLabel('…or paste it').fill(`${readFileSync(FIXTURE, 'utf8')}\nとうみん 冬眠 冬眠/とうみん hibernation noun 10\nコート  コート court noun 5\nへんなことば 変な言葉 変な言葉/へんなことば a made-up word noun 1\n`);
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByTestId('import-lookup')).toHaveText(/Found 50 of them in the dictionary\./);
  await shot(page, testInfo, '82-import-lookup');

  // Settings › Dictionary says what's loaded and how your words match.
  await page.goto('/#/settings/dictionary');
  await expect(page.getByTestId('dict-status')).toContainText('JMdict');
  await expect(page.getByTestId('dict-words')).toHaveText('Your words: 50 in the dictionary, 1 not found.');
  await expect(page.getByRole('link', { name: 'JmdictFurigana' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '83-settings-dictionary');

  // 冬 is an N4 kanji and 眠 isn't: the reading goes over 眠 alone.
  const manga = await listId(request, 'Manga');
  const words = (await (await request.get(`/api/lists/${manga}/words`)).json()) as { id: number; kana: string }[];
  const touminId = words.find((w) => w.kana === 'とうみん')!.id;
  const made = words.find((w) => w.kana === 'へんなことば')!.id;
  for (const w of words) {
    if (w.id !== touminId && w.id !== made) await request.post(`/api/triage/${w.id}`, { data: { result: 'unknown' } });
  }
  await page.goto('/#/check');
  const card = page.getByTestId('triage-card');
  const written = card.locator('.jp-word__written');
  // The check pass shows lowest mastery first: the made-up word (1), then 冬眠 (10).
  await expect(written).toHaveAttribute('data-written', '変な言葉');
  await expect(page.getByTestId('not-in-dictionary')).toBeVisible();
  await shot(page, testInfo, '84-check-not-in-dictionary');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'I didn’t know' }).click();
  await expect(written).toHaveAttribute('data-written', '冬眠');
  await expect(card.locator('rt')).toHaveText(['みん']);
  await expect(page.getByTestId('not-in-dictionary')).toHaveCount(0);

  // コート was matched to "court" by its meaning; pick "coat" instead.
  await page.goto(`/#/lists/${manga}`);
  await page.getByLabel('Search Manga').fill('コート');
  const row = page.getByTestId('word-row').first();
  await row.getByRole('button', { name: /コート/ }).click();
  const panel = row.getByTestId('dict-panel');
  await expect(panel).toContainText('Dictionary: コート');
  await panel.getByText('The dictionary’s meanings (1)').click();
  await expect(panel).toContainText('court (e.g. tennis, basketball, volleyball)');
  await panel.getByRole('button', { name: 'Pick another entry' }).click();
  const coat = panel.getByTestId('dict-row').filter({ hasText: 'coat' }).first();
  await coat.getByRole('button').first().click();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '85-pick-entry');
  await coat.getByRole('button', { name: 'This is the word' }).click();
  await expect(page.getByText('Linked コート to its dictionary entry.')).toBeVisible();
  // The meanings shown are the new entry's.
  await expect(panel.getByText('The dictionary’s meanings (2)')).toBeVisible();
  await expect(panel.getByTestId('dict-row')).toHaveCount(0);
  await expect(panel).toContainText('coating');
  // Its meaning is still yours until you copy the dictionary's.
  await expect(row.getByLabel('Meaning')).toHaveValue('court');
  await row.getByRole('button', { name: 'Use its first meaning as mine' }).click();
  await expect(row.getByLabel('Meaning')).toHaveValue('coat');
  await shot(page, testInfo, '86-word-dictionary');
});

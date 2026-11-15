import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, FIXTURE, listId, resetDb, shot } from './helpers';
import { readFileSync } from 'node:fs';

// The end-to-end dictionary is the sample in test/fixtures/dict_sample.json
// (e2e/prepare.mjs loads it): the Renshuu sample's words and a few more.

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test('look a word up first, read its entry, then add it to a list', async ({ page, request }, testInfo) => {
  const manga = await listId(request, 'Manga');
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Dictionary', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dictionary' })).toBeVisible();

  const search = page.getByLabel('Search the dictionary');
  const rows = page.getByTestId('dict-row');
  await search.fill('taberu');
  await expect(rows.first()).toContainText('食べる');
  await expect(rows.first()).toContainText('to eat');
  await search.fill('hibernation');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('冬眠');
  // An inflected form finds its dictionary form, and says how.
  await search.fill('食べたくなかった');
  await expect(rows.first()).toContainText('食べる');
  await expect(rows.first().getByTestId('dict-inflection')).toHaveText('食べたくなかった is 食べる: want to, negative, past.');
  await search.fill('食べた');
  await expect(rows.first().getByTestId('dict-inflection')).toHaveText('食べた is 食べる: past.');
  // The query is in the address.
  await expect(page).toHaveURL(/#\/dict\?q=%E9%A3%9F%E3%81%B9%E3%81%9F$/);
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '80-dict-search');

  // The entry page: the word with its reading, every sense, and Add to list.
  await rows.first().getByRole('link').click();
  await expect(page).toHaveURL(/#\/dict\/1358280\?q=/);
  const head = page.locator('.dict-entry__word');
  await expect(head).toHaveAttribute('data-written', '食べる');
  await expect(head.locator('rt')).toHaveText(['た']);
  await expect(page.getByText('Ichidan verb · transitive').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play audio' })).toBeVisible();
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(page.getByLabel('Meaning to learn')).toHaveValue('to eat');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '81-dict-entry');
  await page.getByRole('button', { name: 'Add to Manga' }).click();
  await expect(page.getByText('Added 食べる to Manga. It waits for a page.')).toBeVisible();
  await expect(page.getByTestId('dict-mine')).toHaveText('You have 食べる in Manga, waiting. Open it in Manga');

  // Back returns to the results, which now show it as yours.
  await page.getByRole('link', { name: '← Results for “食べた”' }).click();
  await expect(search).toHaveValue('食べた');
  await expect(rows.first()).toContainText('in Manga');
  await page.goBack();
  await expect(page.getByTestId('dict-mine')).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue('食べた');

  // The Dictionary tab starts afresh, and Back still finds the new search.
  await page.getByRole('link', { name: 'Dictionary', exact: true }).click();
  await expect(search).toHaveValue('');
  await search.fill('構わない');
  await expect(rows.first().getByTestId('dict-inflection')).toHaveText('構わない is 構う: negative.');
  await rows.first().getByRole('link').click();
  await expect(page.locator('.dict-entry__word')).toHaveAttribute('data-written', '構う');
  await page.goBack();
  await expect(search).toHaveValue('構わない');
  await search.fill('食べた');
  await expect(rows.first().getByTestId('dict-inflection')).toHaveText('食べた is 食べる: past.');

  // From your entry to the word in its list.
  await rows.first().getByRole('link').click();
  await page.getByRole('link', { name: 'Open it in Manga' }).click();
  const word = page.getByTestId('word-row').first();
  await expect(word.getByLabel('Meaning')).toHaveValue('to eat');
  // And from the word editor back to its entry.
  await word.getByRole('link', { name: 'Open in the dictionary' }).click();
  await expect(page.getByTestId('dict-mine')).toBeVisible();

  // A word usually written in kana is added in kana.
  await page.goto('/#/dict?q=chick');
  await rows.filter({ hasText: 'ひよこ' }).first().getByRole('link').click();
  await expect(page.getByText('usually written in kana')).toBeVisible();
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(page.getByLabel(/Learn it in kana only/)).toBeChecked();
  await page.getByLabel('Meaning to learn').fill('chick');
  await page.getByRole('button', { name: 'Add to Manga' }).click();
  await expect(page.getByText('Added ひよこ to Manga.')).toBeVisible();

  // Both wait for a page in Manga, linked to their entries.
  const words = (await (await request.get(`/api/lists/${manga}/words`)).json()) as { kana: string; kanji: string | null; status: string; dict: string; coreMeaning: string }[];
  expect(words.map((w) => [w.kanji, w.kana, w.status, w.dict, w.coreMeaning])).toEqual([
    ['食べる', 'たべる', 'inbox', 'linked', 'to eat'],
    [null, 'ひよこ', 'inbox', 'linked', 'chick'],
  ]);
});

test('a list’s Add a word opens the dictionary for that list, and old links still work', async ({ page, request }) => {
  const school = await listId(request, 'School');
  await page.goto(`/#/lists/${school}`);
  await page.getByRole('link', { name: 'Add a word' }).click();
  await expect(page.getByRole('heading', { name: 'Dictionary' })).toBeVisible();
  await expect(page.getByRole('link', { name: '← School' })).toBeVisible();
  await page.getByLabel('Search the dictionary').fill('いぬ');
  await page.getByTestId('dict-row').first().getByRole('link').click();
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(page.getByRole('combobox', { name: 'To list' })).toHaveValue(String(school));
  await page.getByRole('button', { name: 'Add to School' }).click();
  await expect(page.getByText('Added 犬 to School.')).toBeVisible();

  // Old Add a word links open the dictionary, with the list kept.
  await page.goto(`/#/add/${school}`);
  await expect(page.getByRole('heading', { name: 'Dictionary' })).toBeVisible();
  await expect(page.getByRole('link', { name: '← School' })).toBeVisible();
  await page.goto('/#/add');
  await expect(page.getByRole('heading', { name: 'Dictionary' })).toBeVisible();
});

test('a compound’s parts open their own entries', async ({ page }, testInfo) => {
  await page.goto('/#/dict?q=yoake');
  await page.getByTestId('dict-row').filter({ hasText: '夜明け' }).first().getByRole('link').click();
  const parts = page.getByTestId('word-parts');
  await expect(parts).toContainText('夜');
  await expect(parts).toContainText('“dawn”');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '87-dict-parts');
  await parts.getByRole('link', { name: '明け' }).click();
  await expect(page.locator('.dict-entry__word')).toHaveAttribute('data-written', '明け');
  await expect(page.getByTestId('word-parts')).toHaveCount(0);
  // Back to the compound, and to the results.
  await page.goBack();
  await expect(page.locator('.dict-entry__word')).toHaveAttribute('data-written', '夜明け');
  await page.getByRole('link', { name: '← Results for “yoake”' }).click();
  await expect(page.getByLabel('Search the dictionary')).toHaveValue('yoake');
  // A mistyped link says so, rather than leaving a blank page.
  await page.goto('/#/dict/%E3');
  await expect(page.getByRole('link', { name: '← Dictionary' })).toBeVisible();
  await expect(page.locator('.notice')).toBeVisible();
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

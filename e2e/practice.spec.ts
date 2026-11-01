import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, graduatePage, listId, resetDb, seedWords, shot, type PageWord } from './helpers';

// Practice that doesn't count: testing yourself on a page before step 1,
// practising learned pages, and memory hooks with a word's parts.

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

/** Counts requests that would change something: practice must send none. */
function countWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
  });
  return writes;
}

test('test yourself on a new page by turning cards over, without counting anything', async ({ page, request }, testInfo) => {
  await seedWords(request, { unknown: 6 });
  const created = await (await request.post('/api/pages', { data: { size: 6 } })).json();
  await page.goto(`/#/pages/${created.id}`);
  const cells = page.locator('.page-cell');
  await expect(cells).toHaveCount(6);
  const writes = countWrites(page);

  await page.getByRole('button', { name: 'Hide meanings' }).click();
  await expect(page.locator('.page-cell[data-covered]')).toHaveCount(6);
  await expect(cells.first().locator('.page-cell__meaning')).toHaveText('?');
  // The Japanese stays, and so does its sound.
  await expect(cells.first().locator('.page-cell__word')).not.toHaveText('?');
  await expect(cells.first().getByRole('button', { name: /^Play/ })).toBeVisible();
  await cells.nth(0).getByRole('button', { name: /turn over/ }).click();
  await cells.nth(2).getByRole('button', { name: /turn over/ }).click();
  await expect(page.locator('.page-cell[data-covered]')).toHaveCount(4);
  await expect(cells.first().locator('.page-cell__meaning')).not.toHaveText('?');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '95-page-self-test');
  // Tapped again, a card covers itself again.
  await cells.nth(2).getByRole('button', { name: /cover again/ }).click();
  await expect(page.locator('.page-cell[data-covered]')).toHaveCount(5);

  // The other side: Japanese covered, sound too (it would give it away).
  await page.getByRole('button', { name: 'Hide Japanese' }).click();
  await expect(page.locator('.page-cell[data-covered]')).toHaveCount(6);
  await expect(cells.first().locator('.page-cell__word')).toHaveText('?');
  await expect(cells.first().getByRole('button', { name: /^Play/ })).toHaveCount(0);
  for (let i = 0; i < 6; i++) await cells.nth(i).getByRole('button', { name: /turn over/ }).click();
  await page.getByRole('button', { name: 'Cover them all again' }).click();
  await expect(page.locator('.page-cell[data-covered]')).toHaveCount(6);

  await page.getByRole('button', { name: 'Show all' }).click();
  await expect(page.locator('.page-cell[data-covered]')).toHaveCount(0);
  expect(writes).toEqual([]);
  // The counted steps are where they were.
  await expect(page.getByRole('button', { name: 'Start step 1' })).toBeVisible();
});

test('write a memory hook on a page, with the word split into its parts', async ({ page, request }, testInfo) => {
  await seedWords(request, { unknown: 48 });
  const manga = await listId(request, 'Manga');
  const all = (await (await request.get(`/api/lists/${manga}/words`)).json()) as { id: number; kanji: string | null }[];
  const ids = ['夜明け', '残酷', '必ず'].map((k) => all.find((w) => w.kanji === k)!.id);
  const created = await (await request.post('/api/pages', { data: { size: 3, listId: manga, wordIds: ids } })).json();
  await page.goto(`/#/pages/${created.id}`);
  await page.getByRole('button', { name: '夜明け: memory hook and parts' }).click();
  const editor = page.getByRole('region', { name: 'Memory hook' });
  // From the dictionary: 夜 "night" + 明け "dawn".
  await expect(editor.getByTestId('word-parts')).toContainText('夜');
  await expect(editor.getByTestId('word-parts')).toContainText('“night”');
  await expect(editor.getByTestId('word-parts')).toContainText('明け');
  await expect(editor.getByTestId('word-parts')).toContainText('“dawn”');
  await editor.getByLabel(/Memory hook for/).fill('YO! A KEttle at dawn');
  await editor.getByRole('button', { name: 'Save hook' }).click();
  await expect(editor.getByRole('status')).toContainText('Saved');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '96-page-hook');

  // Kept: it's on the word, and shows with the answer from now on.
  await page.reload();
  await page.getByRole('button', { name: '夜明け: memory hook and parts' }).click();
  await expect(page.getByRole('region', { name: 'Memory hook' }).getByLabel(/Memory hook for/)).toHaveValue('YO! A KEttle at dawn');
  // A word that isn't made of two dictionary words shows no parts (once the lookup is back).
  const lookup = page.waitForResponse((r) => r.url().includes('/api/dict/parts') && decodeURIComponent(r.url()).includes('残酷'));
  await page.getByRole('button', { name: '残酷: memory hook and parts' }).click();
  await lookup;
  await expect(page.getByRole('region', { name: 'Memory hook' }).getByLabel(/Memory hook for/)).toHaveValue('');
  await expect(page.getByTestId('word-parts')).toHaveCount(0);
});

test('practise one or more learned pages: shuffled, with the page one tap away, and nothing sent', async ({ page, request }, testInfo) => {
  await seedWords(request, { unknown: 6 });
  const first = await graduatePage(request, 3);
  const second = await graduatePage(request, 3);
  const words: PageWord[] = [...first.words, ...second.words];
  const byMeaning = (text: string) => words.find((w) => w.coreMeaning === text.trim())!;

  await page.goto('/#/pages');
  await page.getByRole('link', { name: 'Practise' }).click();
  await expect(page.getByRole('heading', { name: 'Practise' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pick a page to practise' })).toBeDisabled();
  await page.getByLabel(/Page 1\b/).check();
  await page.getByLabel(/Page 2\b/).check();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '97-practise-pick');
  await page.getByRole('button', { name: 'Practise 6 words' }).click();
  await expect(page.getByRole('heading', { name: 'Practise · Pages 1, 2' })).toBeVisible();

  const writes = countWrites(page);
  const card = page.getByTestId('drill-card');
  // One miss, typed once with the page showing, and one look at the whole page: still nothing sent.
  let missed = false;
  // 12 cards, the missed ones again, and maybe a few fillers before them.
  for (let i = 0; i < 30 && !(await page.getByTestId('practice-done').isVisible()); i++) {
    await expect(card.or(page.getByTestId('practice-done'))).toBeVisible();
    if (await page.getByTestId('practice-done').isVisible()) break;
    const direction = await card.getAttribute('data-direction');
    // The page stays out of sight until you ask where the word is.
    await expect(page.locator('.page-grid')).toHaveCount(0);
    if (i === 0) {
      await page.getByRole('button', { name: 'Where is it on the page?' }).click();
      await expect(page.locator('.page-grid')).toBeVisible();
      await expect(page.getByText(/^Page \d, position \d$/)).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, testInfo, '98-practise-peek');
    }
    if (direction === 'jp_en' && !missed) {
      missed = true;
      await page.getByRole('button', { name: 'Show answer' }).click();
      await page.getByRole('button', { name: 'Missed' }).click();
      await expect(page.locator('.page-grid')).toBeVisible();
      const kana = await page.getByTestId('encode-prompt').locator('[lang="ja"]').innerText();
      await page.getByRole('region', { name: 'Type it once' }).getByLabel('Type the word').fill(kana);
      await page.getByRole('region', { name: 'Type it once' }).getByRole('button', { name: 'Check' }).click();
      await page.getByRole('button', { name: 'Study its page again' }).click();
      await page.getByRole('button', { name: 'Back to the drill' }).click();
      continue;
    }
    if (direction === 'jp_en') {
      await page.getByRole('button', { name: 'Show answer' }).click();
      await page.getByRole('button', { name: 'Got it' }).click();
    } else {
      await page.getByLabel('Answer in kana').fill(byMeaning(await card.locator('.prompt-meaning').innerText()).kana);
      await page.getByRole('button', { name: 'Check' }).click();
      await page.getByRole('button', { name: 'Continue' }).click();
    }
  }
  await expect(page.getByTestId('practice-done')).toHaveText('Done: 12 cards, 2 cards needed another go. Nothing was counted.');
  expect(writes).toEqual([]);

  // A single learned page has its own button.
  await page.goto(`/#/pages/${first.id}`);
  await page.getByRole('link', { name: 'Practise this page' }).click();
  await expect(page.getByRole('heading', { name: 'Practise · Page 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page).toHaveURL(new RegExp(`#/pages/${first.id}$`));

  // A link with a page that's gone (or repeated) practises the rest.
  await page.goto(`/#/practise/${second.id},99999,${second.id}`);
  await expect(page.getByRole('heading', { name: 'Practise · Page 2' })).toBeVisible();
});

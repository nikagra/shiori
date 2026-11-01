import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, graduatePage, resetDb, seedWords, shot, typeItOnce, type PageWord } from './helpers';

// From trying v0.1 on the iPhone: a way to say "don't know" up front, no
// reading the next answer off the grid, room to study again, and grid words
// that stay whole.

async function newPage(request: APIRequestContext, size: number) {
  const page = await (await request.post('/api/pages', { data: { size } })).json();
  return page as { id: number; words: PageWord[] };
}

const position = async (page: Page) => Number(await page.locator('.page-cell--current').getAttribute('data-position'));

test.describe('drill', () => {
  let words: PageWord[] = [];
  test.beforeEach(async ({ page, request }) => {
    await resetDb(request);
    await seedWords(request, { unknown: 3 });
    const created = await newPage(request, 3);
    words = created.words;
    await page.goto(`/#/pages/${created.id}`);
    await page.getByRole('button', { name: 'Start step 1' }).click();
  });

  test("don't know yet shows the answer and moves the word to the end", async ({ page }, testInfo) => {
    await page.getByRole('button', { name: 'Don’t know yet' }).click();
    await expect(page.getByTestId('drill-card').locator('.meaning__core')).toContainText(words[0].coreMeaning);
    // No "Got it" after giving up: the only way on is Continue.
    await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);
    await shot(page, testInfo, '40-drill-dont-know');
    await page.getByRole('button', { name: 'Continue' }).click();
    // A miss means typing the word once, looking at it in its spot.
    await expect(page.locator('.page-cell--revealed')).toHaveAttribute('data-position', '0');
    await typeItOnce(page, words[0].kana);
    expect(await position(page)).toBe(1);
    for (const _ of [1, 2]) {
      await page.getByRole('button', { name: 'Show answer' }).click();
      await page.getByRole('button', { name: 'Got it' }).click();
    }
    // The meaning→Japanese pass starts; the missed word comes back after
    // MISS_GAP cards, here the end of this small drill (answerStep's unit
    // tests cover the gap and the fillers).
    await expect(page.getByTestId('drill-card')).toHaveAttribute('data-direction', 'en_jp');
    expect(await position(page)).toBe(0);
  });

  test('in order, words still to be asked are hidden on the grid', async ({ page }, testInfo) => {
    for (const _ of words) {
      await page.getByRole('button', { name: 'Show answer' }).click();
      await page.getByRole('button', { name: 'Got it' }).click();
    }
    await expect(page.getByTestId('drill-card')).toHaveAttribute('data-direction', 'en_jp');
    const shown = page.locator('.page-grid .page-cell__word:not(.page-cell__word--hidden)');
    await expect(shown).toHaveCount(0);
    await shot(page, testInfo, '41-drill-next-hidden');

    await page.getByLabel('Answer in kana').fill(words[0].kana);
    await page.getByRole('button', { name: 'Check' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    // Only the word just answered is back on the grid.
    await expect(shown).toHaveCount(1);
    await expect(page.locator('.page-cell[data-position="0"] .page-cell__word')).toBeVisible();

    await page.getByRole('button', { name: 'Don’t know yet' }).click();
    await expect(page.getByTestId('typed-result')).toContainText('comes back after a few cards');
    await expect(page.getByRole('button', { name: /typo/ })).toHaveCount(0);
  });

  test('a missed word coming round again keeps upcoming answers hidden', async ({ page }) => {
    const card = page.getByTestId('drill-card');
    // Japanese→meaning: give up on word 1, know words 2 and 3.
    await page.getByRole('button', { name: 'Don’t know yet' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await typeItOnce(page, words[0].kana);
    for (const _ of [1, 2]) {
      await page.getByRole('button', { name: 'Show answer' }).click();
      await page.getByRole('button', { name: 'Got it' }).click();
    }
    // Meaning→Japanese: know word 1, give up on word 2, know word 3.
    await page.getByLabel('Answer in kana').fill(words[0].kana);
    await page.getByRole('button', { name: 'Check' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Don’t know yet' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await typeItOnce(page, words[1].kana);
    await page.getByLabel('Answer in kana').fill(words[2].kana);
    await page.getByRole('button', { name: 'Check' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    // Word 1 comes round again Japanese→meaning; word 2 is still to be typed,
    // so it must not be on the grid.
    await expect(card).toHaveAttribute('data-direction', 'jp_en');
    expect(await position(page)).toBe(0);
    await expect(page.locator('.page-cell[data-position="1"] .page-cell__word')).toHaveCount(0);
    await expect(page.locator('.page-cell[data-position="2"] .page-cell__word')).toBeVisible();
  });

  test('study the page again in the middle of a drill', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: 'Study the page again' }).click();
    await expect(page.locator('.page-grid--full')).toBeVisible();
    await expect(page.locator('.page-cell__meaning').first()).toContainText(words[0].coreMeaning);
    await shot(page, testInfo, '42-drill-study-again');
    await page.getByRole('button', { name: 'Back to the drill' }).click();
    // The word that was on screen counts as missed and waits at the end.
    expect(await position(page)).toBe(1);
  });
});

test.describe('review', () => {
  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    await seedWords(request, { unknown: 2 });
    await graduatePage(request, 2);
  });

  test("don't know on a reading card goes straight to Again", async ({ page, request }, testInfo) => {
    await request.post('/api/test/make-due?direction=jp_en');
    await page.goto('/#/review');
    await expect(page.getByTestId('dont-know-hint')).toHaveText('Don’t know counts as Again. Show answer lets you grade yourself.');
    await page.getByRole('button', { name: 'Don’t know' }).click();
    await expect(page.getByTestId('review-card').locator('.meaning__core')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Good' })).toHaveCount(0);
    await expect(page.getByTestId('again-note')).toContainText('Counted as Again');
    await shot(page, testInfo, '43-review-dont-know');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('2 / 2')).toBeVisible();
  });

  test("don't know on a typing card shows the word, no typo override", async ({ page, request }) => {
    await request.post('/api/test/make-due?direction=en_jp');
    await page.goto('/#/review');
    await expect(page.getByTestId('review-card')).toHaveAttribute('data-direction', 'en_jp');
    await page.getByRole('button', { name: 'Don’t know' }).click();
    await expect(page.getByTestId('typed-result')).toHaveText('Here it is');
    await expect(page.getByRole('button', { name: /typo/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  });
});

test('long words stay whole in the grid', async ({ page, request }, testInfo) => {
  await resetDb(request);
  const text = [
    '申し込み書/もうしこみしょ - application form',
    '自己紹介する/じこしょうかいする - to introduce oneself',
    '一生懸命/いっしょうけんめい - with utmost effort',
    '見知らぬ/みしらぬ - unfamiliar',
    '誰か/だれか - someone',
    '日本/にほん - Japan',
  ].join('\n');
  await request.post('/api/import', { data: { text, list: 'other' } });
  const triage = await (await request.get('/api/triage')).json();
  for (const w of triage.words as { id: number }[]) await request.post(`/api/triage/${w.id}`, { data: { result: 'unknown' } });
  const created = await newPage(request, 6);
  await page.goto(`/#/pages/${created.id}`);
  const cells = page.locator('.page-cell');
  await expect(cells).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const cell = cells.nth(i);
    const word = cell.locator('.page-cell__word');
    const [c, w] = await Promise.all([cell.boundingBox(), word.boundingBox()]);
    // One line, inside its cell.
    expect(w!.width).toBeLessThanOrEqual(c!.width);
    expect(w!.height).toBeLessThan(2 * 1.6 * 16);
  }
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '44-grid-long-words');
});

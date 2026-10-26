import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, resetDb, seedWords, shot, type PageWord } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetDb(request);
  await seedWords(request, { unknown: 12 });
});

async function currentWord(page: Page, words: PageWord[]): Promise<PageWord> {
  const position = Number(await page.locator('.page-cell--current').getAttribute('data-position'));
  return words.find((w) => w.position === position)!;
}

async function answerDrill(page: Page, words: PageWord[], opts: { missFirstTyped?: boolean } = {}) {
  let missed = !opts.missFirstTyped;
  const seen: string[] = [];
  for (let guard = 0; guard < 100; guard++) {
    const card = page.getByTestId('drill-card');
    if (!(await card.isVisible().catch(() => false))) break;
    const word = await currentWord(page, words);
    const direction = await card.getAttribute('data-direction');
    seen.push(`${word.position}:${direction}`);
    if (direction === 'jp_en') {
      await page.getByRole('button', { name: 'Show answer' }).click();
      await page.getByRole('button', { name: 'Got it' }).click();
    } else {
      // The target cell is hidden while you produce the word.
      await expect(page.locator('.page-cell--current .page-cell__word--hidden')).toBeVisible();
      const input = page.getByLabel('Answer in kana');
      if (!missed) {
        await input.fill('まちがい');
        await page.getByRole('button', { name: 'Check' }).click();
        await expect(page.getByTestId('typed-result')).toContainText('Not quite');
        await page.getByRole('button', { name: 'Continue' }).click();
        missed = true;
        continue;
      }
      await input.fill(word.kana);
      await page.getByRole('button', { name: 'Check' }).click();
      await expect(page.getByTestId('typed-result')).toHaveText('Correct');
      await page.getByRole('button', { name: 'Continue' }).click();
    }
  }
  return seen;
}

test('learn a page: study, in order, shuffled, then it graduates', async ({ page, request }, testInfo) => {
  await page.goto('/#/settings');
  await page.getByRole('group', { name: 'Words per page' }).getByRole('button', { name: '10' }).click();
  await page.goto('/#/pages');
  await expect(page.getByText('12 words waiting')).toBeVisible();
  await shot(page, testInfo, '10-pages-new');
  await page.getByRole('button', { name: 'Start a new page' }).click();

  await expect(page.getByRole('heading', { name: 'Page 1' })).toBeVisible();
  const cells = page.locator('.page-cell');
  await expect(cells).toHaveCount(10);
  // Three columns on every screen size: cells 1–3 share a row, 4 starts the next.
  const boxes = await Promise.all([0, 1, 2, 3].map((i) => cells.nth(i).boundingBox()));
  expect(boxes[0]!.y).toBe(boxes[1]!.y);
  expect(boxes[1]!.y).toBe(boxes[2]!.y);
  expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y);
  expect(boxes[3]!.x).toBe(boxes[0]!.x);
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '11-page-study');

  const pageId = Number(page.url().split('/').pop());
  const detail = await (await request.get(`/api/pages/${pageId}`)).json();
  const words = detail.words as PageWord[];

  await page.getByRole('button', { name: 'Start step 1' }).click();
  await expect(page.getByTestId('drill-card')).toHaveAttribute('data-direction', 'jp_en');
  await expect(page.locator('.page-cell--current')).toHaveAttribute('data-position', '0');
  await shot(page, testInfo, '12-drill-ordered-reading');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '13-drill-ordered-answer');
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('.page-cell--current')).toHaveAttribute('data-position', '1');

  const ordered = await answerDrill(page, words, { missFirstTyped: true });
  // Reading pass in grid order (after the first word), then production in grid order,
  // with the missed word repeated at the end.
  expect(ordered.slice(0, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => `${p}:jp_en`));
  expect(ordered.slice(9, 20)).toEqual([...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => `${p}:en_jp`), '0:en_jp']);

  await expect(page.getByRole('heading', { name: 'Step 2 · Shuffled' })).toBeVisible();
  await page.getByRole('button', { name: 'Start step 2' }).click();
  // Shuffled: only positions, no words on the grid.
  await expect(page.locator('.page-grid--blank')).toBeVisible();
  await expect(page.locator('.page-grid--blank .page-cell__word:not(.page-cell__word--hidden)')).toHaveCount(0);
  await shot(page, testInfo, '14-drill-shuffled');
  const shuffled = await answerDrill(page, words);
  expect(shuffled).toHaveLength(20);
  expect(new Set(shuffled).size).toBe(20);

  await expect(page.getByTestId('page-learned')).toBeVisible();
  await shot(page, testInfo, '15-page-learned');

  // First reviews come tomorrow, not today.
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByTestId('tile-review')).toContainText('0');
  await expect(page.getByTestId('tile-inbox')).toContainText('2');
});

test('stopping a drill keeps the page at its step', async ({ page }) => {
  await page.goto('/#/pages');
  await page.getByRole('button', { name: 'Start a new page' }).click();
  await page.getByRole('button', { name: 'Start step 1' }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Start step 1' })).toBeVisible();
  await page.getByRole('link', { name: 'All pages' }).click();
  await expect(page.getByText('Step 1 of 2')).toBeVisible();
});

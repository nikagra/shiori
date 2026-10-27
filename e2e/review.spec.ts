import { expect, test, type APIRequestContext } from '@playwright/test';
import { expectNoHorizontalScroll, graduatePage, resetDb, seedWords, shot, type PageWord } from './helpers';

let words: PageWord[] = [];

test.beforeEach(async ({ request }) => {
  await resetDb(request);
  await seedWords(request, { unknown: 4 });
  words = (await graduatePage(request, 4)).words;
});

// Pretend a day has passed, for all cards or one direction only.
const makeDue = (request: APIRequestContext, direction?: 'jp_en' | 'en_jp') =>
  request.post(`/api/test/make-due${direction ? `?direction=${direction}` : ''}`);

const byPrompt = (text: string) => words.find((w) => (w.kanji ?? w.kana) === text.trim() || w.coreMeaning === text.trim())!;

test('review both directions with honest grading', async ({ page, request }, testInfo) => {
  await makeDue(request);
  await page.goto('/');
  // 4 words × 2 directions are due, but only one direction per word per day.
  await expect(page.getByTestId('tile-review')).toContainText('4');
  await page.getByTestId('tile-review').click();

  const graded: string[] = [];
  for (let i = 0; i < 4; i++) {
    const card = page.getByTestId('review-card');
    // Wait for the next card before reading it.
    await expect(page.getByText(`${i + 1} / 4`)).toBeVisible();
    const direction = (await card.getAttribute('data-direction'))!;
    if (direction === 'jp_en') {
      const word = byPrompt((await card.locator('.jp-word__written').getAttribute('data-written'))!);
      // Grades stay hidden until the answer is revealed.
      await expect(page.getByRole('button', { name: 'Good' })).toHaveCount(0);
      if (i === 0) await shot(page, testInfo, '20-review-reading-prompt');
      await page.getByRole('button', { name: 'Show answer' }).click();
      await expect(card.locator('.meaning__core')).toContainText(word.coreMeaning);
      // A line under the buttons says when the word would come back after each grade.
      await expect(page.getByTestId('grade-intervals').locator(':scope > span')).toHaveText(Array(4).fill(/^~\d+(\.\d)?(m|h|d|w|mo|y)$/));
      // The number, not the tilde before it, sits under the middle of its button.
      const offsets = await page.getByTestId('grade-intervals').evaluate((row) => {
        const buttons = [...row.previousElementSibling!.querySelectorAll('button')];
        return [...row.children].map((cell, i) => {
          const range = document.createRange();
          range.selectNode(cell.lastChild!);
          const number = range.getBoundingClientRect();
          const button = buttons[i].getBoundingClientRect();
          return Math.abs(number.left + number.width / 2 - (button.left + button.width / 2));
        });
      });
      for (const offset of offsets) expect(offset).toBeLessThan(1);
      if (graded.length === 0) await shot(page, testInfo, '21-review-reading-answer');
      await page.getByRole('button', { name: 'Good' }).click();
    } else {
      const word = byPrompt(await card.locator('.prompt-meaning').innerText());
      if (!graded.includes('wrong')) {
        await page.getByLabel('Answer in kana').fill('ちがう');
        await page.getByRole('button', { name: 'Check' }).click();
        await expect(page.getByTestId('typed-result')).toContainText('Not quite');
        // A wrong answer can only be graded Again (unless it was a typo).
        await expect(page.getByRole('button', { name: 'Good' })).toHaveCount(0);
        await expectNoHorizontalScroll(page);
        await shot(page, testInfo, '22-review-typed-wrong');
        await page.getByRole('button', { name: 'Again' }).click();
        graded.push('wrong');
        continue;
      }
      await page.getByLabel('Answer in kana').fill(word.kana);
      await page.getByRole('button', { name: 'Check' }).click();
      await expect(page.getByTestId('typed-result')).toHaveText('Correct');
      await page.getByRole('button', { name: 'Good' }).click();
    }
    graded.push(direction);
  }
  await expect(page.getByTestId('review-done')).toHaveText('Done: 4 reviewed.');
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByTestId('tile-review')).toContainText('0');
});

test('peeking at the page caps the grade at Hard', async ({ page, request }, testInfo) => {
  await makeDue(request);
  await page.goto('/#/review');
  await page.getByRole('button', { name: /Where did I learn this/ }).click();
  await expect(page.getByRole('region', { name: 'Page hint' })).toBeVisible();
  // The word itself stays hidden in the hint.
  await expect(page.locator('.page-cell--current .page-cell__word--hidden')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '23-review-hint');

  const card = page.getByTestId('review-card');
  if ((await card.getAttribute('data-direction')) === 'jp_en') {
    await page.getByRole('button', { name: 'Show answer' }).click();
  } else {
    const word = byPrompt(await card.locator('.prompt-meaning').innerText());
    await page.getByLabel('Answer in kana').fill(word.kana);
    await page.getByRole('button', { name: 'Check' }).click();
  }
  await expect(page.getByRole('button', { name: 'Good' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Easy' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Hard' })).toBeEnabled();

  // The guide to the grades is one tap away.
  await page.getByRole('link', { name: 'How grading works' }).click();
  await expect(page).toHaveURL(/#\/settings\/grading$/);
  const grading = page.getByRole('region', { name: 'Grading' });
  await expect(grading).toBeInViewport();
  await shot(page, testInfo, '24-settings-grading');

  // Once you know what the grades do, the line can go (on every device).
  await grading.getByLabel('Show when each grade brings the word back').uncheck();
  await expect.poll(async () => (await (await request.get('/api/study')).json()).showIntervals).toBe(false);
  await page.goto('/#/review');
  await page.getByRole('button', { name: /Show answer|Check/ }).first().waitFor();
  if ((await card.getAttribute('data-direction')) === 'jp_en') await page.getByRole('button', { name: 'Show answer' }).click();
  else {
    await page.getByLabel('Answer in kana').fill(byPrompt(await card.locator('.prompt-meaning').innerText()).kana);
    await page.getByRole('button', { name: 'Check' }).click();
  }
  await expect(page.getByRole('button', { name: 'Good' })).toBeVisible();
  await expect(page.getByTestId('grade-intervals')).toHaveCount(0);
});

test('a typo can be counted as correct', async ({ page, request }) => {
  await makeDue(request, 'en_jp');
  await page.goto('/#/review');
  await expect(page.getByTestId('review-card')).toHaveAttribute('data-direction', 'en_jp');
  await page.getByLabel('Answer in kana').fill('x');
  await page.getByRole('button', { name: 'Check' }).click();
  await page.getByRole('button', { name: /It was a typo/ }).click();
  await expect(page.getByTestId('typed-result')).toHaveText('Counted as correct');
  await expect(page.getByRole('button', { name: 'Good' })).toBeEnabled();
});

test('edit a core meaning from the answer', async ({ page, request }) => {
  await makeDue(request, 'jp_en');
  await page.goto('/#/review');
  const card = page.getByTestId('review-card');
  await expect(card).toHaveAttribute('data-direction', 'jp_en');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await card.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Core meaning').fill('my own meaning');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.locator('.meaning__core')).toContainText('my own meaning');
});

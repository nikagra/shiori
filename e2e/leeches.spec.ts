import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, graduatePage, listId, resetDb, seedWords, shot, studyDay, type PageWord } from './helpers';

// A word that keeps slipping leaves review until you give it a new approach.

let words: PageWord[] = [];

test.beforeEach(async ({ request }) => {
  await resetDb(request);
  await seedWords(request, { unknown: 4 });
  words = (await graduatePage(request, 2)).words;
});

test('a leech leaves review, then gets a hook and a fresh page', async ({ page, request }, testInfo) => {
  // Three lapses already; the fourth comes from review.
  for (const w of words) expect((await request.post(`/api/test/lapses/${w.id}?n=3`)).ok()).toBeTruthy();
  expect((await request.post('/api/test/make-due')).ok()).toBeTruthy();
  await page.goto('/#/review');
  const card = page.getByTestId('review-card');
  const leech = words.find((w) => w.id === words[0].id)!;
  for (let i = 0; i < 2; i++) {
    await expect(page.getByText(`${i + 1} / 2`)).toBeVisible();
    const direction = await card.getAttribute('data-direction');
    const prompt = direction === 'jp_en' ? await card.locator('.jp-word__written').getAttribute('data-written') : await card.locator('.prompt-meaning').innerText();
    const isLeech = prompt === (leech.kanji ?? leech.kana) || prompt === leech.coreMeaning;
    if (direction === 'jp_en') await page.getByRole('button', { name: 'Show answer' }).click();
    else {
      await page.getByLabel('Answer in kana').fill(isLeech ? 'ちがう' : words[1].kana);
      await page.getByRole('button', { name: 'Check' }).click();
    }
    await page.getByRole('button', { name: !isLeech ? 'Good' : direction === 'jp_en' ? 'Again' : 'Continue' }).click();
  }
  await expect(page.getByTestId('leech-notice')).toContainText('keeps slipping, so it leaves review for now');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '90-review-leech');

  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByTestId('home-leeches')).toContainText('1 word needs a new approach: Manga (1)');
  await page.getByRole('link', { name: 'Manga (1)' }).click();
  await expect(page.getByRole('button', { name: /Leeches only/ })).toHaveAttribute('aria-pressed', 'true');
  const rows = page.getByTestId('word-row');
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole('button').first().click();
  const editor = page.getByRole('group', { name: `Edit ${leech.kanji ?? leech.kana}` });
  await expect(editor.getByRole('region', { name: /is a leech/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '91-list-leech');

  await page.getByRole('button', { name: 'Put it on a fresh page' }).click();
  await expect(page.getByText('waits for a fresh page, first in line')).toBeVisible();
  // No leeches left, so the filter shows nothing.
  await expect(rows).toHaveCount(0);
  // A hook for the fresh start.
  // Its editor stays open with the filter off.
  await page.getByRole('button', { name: /Leeches only/ }).click();
  await editor.getByLabel('Memory hook').fill('a picture that sticks');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/^Saved/)).toBeVisible();

  await page.getByRole('link', { name: 'Pages', exact: true }).click();
  await page.getByRole('button', { name: 'Start a new page' }).click();
  await expect(page.locator('.page-cell[data-position="0"] .page-cell__word')).toHaveAttribute('data-written', leech.kanji ?? leech.kana);
  // The hook shows with the answer.
  await page.getByRole('button', { name: 'Start step 1' }).click();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByTestId('hook')).toHaveText('Your hook: a picture that sticks');
});

test('a clearer meaning lets a leech back into review', async ({ page, request }) => {
  const w = words[1];
  expect((await request.post(`/api/test/lapses/${w.id}?n=3`)).ok()).toBeTruthy();
  expect((await request.post('/api/test/make-due')).ok()).toBeTruthy();
  const { start, end } = studyDay();
  const queue = await request.get(`/api/review?dayStart=${encodeURIComponent(start.toISOString())}&dayEnd=${encodeURIComponent(end.toISOString())}`);
  const cardId = ((await queue.json()).items as { cardId: number; word: { id: number } }[]).find((c) => c.word.id === w.id)!.cardId;
  expect((await (await request.post(`/api/review/${cardId}`, { data: { rating: 1 } })).json()).leech).toBe(true);

  await page.goto(`/#/lists/${await listId(request, 'Manga')}/leeches`);
  await page.getByTestId('word-row').first().getByRole('button').first().click();
  await page.getByLabel('Meaning').fill('to come out (of a socket)');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/It is back in review/)).toBeVisible();
  await page.goto('/');
  await expect(page.getByTestId('home-leeches')).toHaveCount(0);
});

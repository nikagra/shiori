import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, graduatePage, resetDb, seedWords, shot, type PageWord } from './helpers';

let word: PageWord;

test.beforeEach(async ({ request }) => {
  await resetDb(request);
  await seedWords(request, { unknown: 4 });
  const words = (await graduatePage(request, 4)).words;
  word = words.find((w) => w.kanji)!;
  // Count every kanji on the page as known, so the questions show no furigana.
  const known = words.map((w) => w.kanji ?? '').join('');
  await request.put('/api/furigana', { data: { kanjiLevel: 'n4', knownKanji: known, learningKanji: '' } });
  await request.post('/api/test/make-due?direction=jp_en');
});

const kanjiOf = (w: PageWord) => [...new Set([...(w.kanji ?? '')].filter((ch) => /\p{Script=Han}/u.test(ch)))].join('');

test('peek at furigana on a question; a second peek moves the kanji to still learning', async ({ page, request }, testInfo) => {
  // One earlier peek at these kanji, as if from another card.
  await request.post('/api/furigana/hint', { data: { wordId: word.id, kanji: kanjiOf(word) } });

  await page.goto('/#/review');
  const card = page.getByTestId('review-card');
  await expect(card).toHaveAttribute('data-direction', 'jp_en');
  // Find our word's card: the queue order is not fixed.
  for (let i = 0; i < 4; i++) {
    // Wait for the next card before reading it.
    await expect(page.getByText(`${i + 1} / 4`)).toBeVisible();
    if ((await card.locator('.jp-word__written').getAttribute('data-written')) === word.kanji) break;
    await page.getByRole('button', { name: 'Show answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();
  }
  await expect(card.locator('.jp-word__written')).toHaveAttribute('data-written', word.kanji!);
  await expect(card.locator('rt')).toHaveCount(0);

  await card.getByRole('button', { name: 'Show furigana' }).click();
  await expect(card.locator('rt').first()).toBeVisible();
  await expect(card.getByRole('button', { name: 'Show furigana' })).toHaveCount(0);
  await expect(page.getByTestId('moved-to-learning')).toContainText('moved to Still learning');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '30-review-furigana-peek');

  // The peek counts against the kanji, not the word: every grade stays open.
  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByRole('button', { name: 'Good' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Easy' })).toBeEnabled();

  // Settings shows the kanji under Still learning, on any device.
  const prefs = await (await request.get('/api/furigana')).json();
  for (const k of kanjiOf(word)) expect(prefs.prefs.learningKanji).toContain(k);
});

test('furigana settings are shared between devices', async ({ page, browser }, testInfo) => {
  await page.goto('/#/settings');
  const section = page.getByRole('region', { name: 'Furigana' });
  await section.getByLabel('Kanji I know').selectOption('n5');
  await section.getByLabel('Still learning').fill('験貸');
  await section.getByLabel('Still learning').blur();
  await expect.poll(async () => (await (await page.request.get('/api/furigana')).json()).prefs).toEqual({
    kanjiLevel: 'n5',
    knownKanji: expect.any(String),
    learningKanji: '験貸',
  });
  await shot(page, testInfo, '31-settings-furigana');

  // A fresh browser has its own local storage, like the other device.
  const other = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const phone = await other.newPage();
  await phone.goto('/#/settings');
  const otherSection = phone.getByRole('region', { name: 'Furigana' });
  await expect(otherSection.getByLabel('Kanji I know')).toHaveValue('n5');
  await expect(otherSection.getByLabel('Still learning')).toHaveValue('験貸');
  await other.close();
});

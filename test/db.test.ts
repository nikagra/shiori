import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseRenshuuExport } from '../shared/renshuu';
import { Rating, State } from '../shared/scheduler';
import * as repo from '../worker/db';
import { createTestDb } from './d1';

const words = parseRenshuuExport(readFileSync(join(import.meta.dirname, 'fixtures', 'renshuu_custom_sample.txt'), 'utf8')).words;

const now = new Date('2026-10-25T20:00:00Z');
const dayStart = new Date('2026-10-25T03:00:00Z');
const dayEnd = new Date('2026-10-26T03:00:00Z');
const nextDay = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

/** The starting lists are Manga, Books, School and Other, in that order. */
const MANGA = 1;
const BOOKS = 2;

let db: D1Database;
beforeEach(() => {
  db = createTestDb();
});

async function importAndSort(known: number, unknown: number) {
  await repo.importWords(db, words, MANGA, now);
  const { words: batch } = await repo.triageNext(db, known + unknown);
  for (const w of batch.slice(0, known)) await repo.triageAnswer(db, w.id, 'known', now);
  for (const w of batch.slice(known, known + unknown)) await repo.triageAnswer(db, w.id, 'unknown', now);
  return batch;
}

describe('import', () => {
  it('adds words as unverified and skips duplicates on re-import', async () => {
    expect(await repo.importWords(db, words, MANGA, now)).toEqual({ added: 48, duplicates: 0 });
    expect(await repo.importWords(db, words, MANGA, now)).toEqual({ added: 0, duplicates: 48 });
    const s = await repo.stats(db, dayStart, dayEnd);
    expect(s).toMatchObject({ toCheck: 48, inbox: 0, learned: 0, reviewsDue: 0 });
  });

  it('stores a short core meaning next to the full senses', async () => {
    await repo.importWords(db, words, MANGA, now);
    const { words: list } = await repo.triageNext(db, 50);
    const toru = list.find((w) => w.kanji === '助ける')!;
    expect(toru.coreMeaning).toBe('to save, to rescue, to spare');
    expect(toru.senses.length).toBeGreaterThan(1);
    expect(toru).toMatchObject({ sourceList: 'Manga', listId: MANGA });
  });
});

describe('triage', () => {
  it('goes from lowest mastery up', async () => {
    await repo.importWords(db, words, MANGA, now);
    const { words: list, remaining } = await repo.triageNext(db, 50);
    expect(remaining).toBe(48);
    const masteries = list.map((w) => w.mastery ?? 50);
    expect(masteries).toEqual([...masteries].sort((a, b) => a - b));
  });

  it('known words get a reviewed reading card and a new production card', async () => {
    const [w] = await importAndSort(1, 0);
    const word = await repo.getWord(db, w.id);
    expect(word.status).toBe('graduated');
    const q = await repo.reviewQueue(db, dayStart, dayEnd, 50);
    // The reading card is not due yet; the new meaning→Japanese card is.
    expect(q.items.map((i) => [i.word.id, i.direction, i.state])).toEqual([[w.id, 'en_jp', State.New]]);
  });

  it('unknown words wait in the inbox; ignored words leave', async () => {
    await repo.importWords(db, words, MANGA, now);
    const { words: list } = await repo.triageNext(db, 2);
    await repo.triageAnswer(db, list[0].id, 'unknown', now);
    await repo.triageAnswer(db, list[1].id, 'ignore', now);
    expect((await repo.getWord(db, list[0].id)).status).toBe('inbox');
    expect((await repo.getWord(db, list[1].id)).status).toBe('ignored');
    await expect(repo.triageAnswer(db, list[0].id, 'known', now)).rejects.toMatchObject({ status: 409 });
  });

  it('two answers racing for one word: one counts, and an inbox word gets no cards', async () => {
    await repo.importWords(db, words, MANGA, now);
    const { words: list } = await repo.triageNext(db, 1);
    const results = await Promise.allSettled([repo.triageAnswer(db, list[0].id, 'unknown', now), repo.triageAnswer(db, list[0].id, 'known', now)]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const word = await repo.getWord(db, list[0].id);
    const cards = await db.prepare('SELECT COUNT(*) AS n FROM cards WHERE word_id = ?').bind(list[0].id).first<{ n: number }>();
    expect(cards!.n).toBe(word.status === 'graduated' ? 2 : 0);
  });
});

describe('pages', () => {
  it('builds a page from the inbox in source order and keeps positions', async () => {
    const sorted = await importAndSort(0, 12);
    const page = await repo.createPage(db, 10, null, now);
    expect(page.number).toBe(1);
    expect(page.stage).toBe('ordered');
    expect(page.words.map((w) => w.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const inSourceOrder = sorted.slice().sort((a, b) => words.findIndex((x) => x.kana === a.kana && x.kanji === a.kanji) - words.findIndex((x) => x.kana === b.kana && x.kanji === b.kanji));
    expect(page.words.map((w) => w.id)).toEqual(inSourceOrder.slice(0, 10).map((w) => w.id));
    expect((await repo.stats(db, dayStart, dayEnd)).inbox).toBe(2);
  });

  it('refuses an empty inbox', async () => {
    await expect(repo.createPage(db, 10, null, now)).rejects.toMatchObject({ status: 409 });
  });

  it('graduates after both stages; reviews start the next day', async () => {
    await importAndSort(0, 3);
    const page = await repo.createPage(db, 10, null, now);
    expect((await repo.completeStage(db, page.id, 'ordered', dayEnd, now)).stage).toBe('shuffled');
    // Repeating a finished stage is harmless.
    expect((await repo.completeStage(db, page.id, 'ordered', dayEnd, now)).stage).toBe('shuffled');
    const done = await repo.completeStage(db, page.id, 'shuffled', dayEnd, now);
    expect(done.stage).toBe('graduated');
    expect(done.words.every((w) => w.status === 'graduated')).toBe(true);

    expect((await repo.reviewQueue(db, dayStart, dayEnd, 50)).total).toBe(0);
    const tomorrow = await repo.reviewQueue(db, dayEnd, nextDay(dayEnd, 1), 50);
    // 3 words × 2 directions, but only one direction per word per day.
    expect(tomorrow.total).toBe(3);
    expect(tomorrow.items[0].page).toMatchObject({ id: page.id, number: 1 });
  });
});

describe('drill misses', () => {
  const cardOf = async (wordId: number, direction: string) =>
    JSON.parse((await db.prepare('SELECT fsrs FROM cards WHERE word_id = ? AND direction = ?').bind(wordId, direction).first<{ fsrs: string }>())!.fsrs);
  const ratingOf = async (wordId: number, direction: string) =>
    (await db
      .prepare(`SELECT r.rating FROM review_log r JOIN cards c ON c.id = r.card_id WHERE r.kind = 'graduation' AND c.word_id = ? AND c.direction = ?`)
      .bind(wordId, direction)
      .first<{ rating: number }>())!.rating;

  it('keeps each step\'s misses and starts each card by its step 2 misses', async () => {
    await importAndSort(0, 3);
    const page = await repo.createPage(db, 10, null, now);
    const [a, b, c] = page.words.map((w) => w.id);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now, [{ wordId: a, direction: 'jp_en', misses: 3 }]);
    const done = await repo.completeStage(db, page.id, 'shuffled', dayEnd, now, [
      { wordId: b, direction: 'en_jp', misses: 1 },
      { wordId: c, direction: 'jp_en', misses: 2 },
    ]);
    expect(done.stage).toBe('graduated');
    expect(done.words.map((w) => w.misses)).toEqual([
      { step1: { jp_en: 3, en_jp: 0 }, step2: { jp_en: 0, en_jp: 0 } },
      { step1: { jp_en: 0, en_jp: 0 }, step2: { jp_en: 0, en_jp: 1 } },
      { step1: { jp_en: 0, en_jp: 0 }, step2: { jp_en: 2, en_jp: 0 } },
    ]);
    // Step 1 misses don't change the start; step 2 misses do.
    expect(await ratingOf(a, 'jp_en')).toBe(Rating.Good);
    expect(await ratingOf(b, 'jp_en')).toBe(Rating.Good);
    expect(await ratingOf(b, 'en_jp')).toBe(Rating.Hard);
    expect(await ratingOf(c, 'jp_en')).toBe(Rating.Again);
    const good = await cardOf(a, 'jp_en');
    const hard = await cardOf(b, 'en_jp');
    const again = await cardOf(c, 'jp_en');
    expect(again.stability).toBeLessThan(hard.stability);
    expect(hard.stability).toBeLessThan(good.stability);
    // Whatever the grade, the first review is the next day.
    for (const card of [good, hard, again]) expect(card.due).toBe(dayEnd.toISOString());
    expect((await repo.reviewQueue(db, dayStart, dayEnd, 50)).total).toBe(0);
    expect((await repo.reviewQueue(db, dayEnd, nextDay(dayEnd, 1), 50)).total).toBe(3);
  });

  it('a repeated finish records nothing twice', async () => {
    await importAndSort(0, 2);
    const page = await repo.createPage(db, 10, null, now);
    const [a] = page.words.map((w) => w.id);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now, [{ wordId: a, direction: 'en_jp', misses: 1 }]);
    const again = await repo.completeStage(db, page.id, 'ordered', dayEnd, now, [{ wordId: a, direction: 'en_jp', misses: 4 }]);
    expect(again.words[0].misses.step1.en_jp).toBe(1);
  });

  it('refuses misses for words not on the page or sent twice', async () => {
    await importAndSort(0, 3);
    const page = await repo.createPage(db, 2, null, now);
    const other = (await repo.createPage(db, 1, null, now)).words[0].id;
    const [a] = page.words.map((w) => w.id);
    await expect(repo.completeStage(db, page.id, 'ordered', dayEnd, now, [{ wordId: other, direction: 'jp_en', misses: 1 }])).rejects.toMatchObject({ status: 400 });
    await expect(
      repo.completeStage(db, page.id, 'ordered', dayEnd, now, [
        { wordId: a, direction: 'jp_en', misses: 1 },
        { wordId: a, direction: 'jp_en', misses: 2 },
      ]),
    ).rejects.toMatchObject({ status: 400 });
    await expect(repo.completeStage(db, page.id, 'ordered', dayEnd, now, [{ wordId: a, direction: 'jp_en', misses: -1 }])).rejects.toMatchObject({ status: 400 });
    expect((await repo.getPage(db, page.id)).stage).toBe('ordered');
  });
});

describe('leeches', () => {
  /** A word learned from a page, and its reading card's id. */
  async function learnedWord() {
    await importAndSort(0, 1);
    const page = await repo.createPage(db, 1, null, now);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    await repo.completeStage(db, page.id, 'shuffled', dayEnd, now);
    const card = await db.prepare(`SELECT id FROM cards WHERE word_id = ? AND direction = 'jp_en'`).bind(page.words[0].id).first<{ id: number }>();
    return { wordId: page.words[0].id, cardId: card!.id, pageId: page.id };
  }
  const grade = (cardId: number, rating: number, at: Date) =>
    repo.submitReview(db, { cardId, rating: rating as never, hintUsed: false, answer: null, correct: null, durationMs: null }, at);
  const word = (id: number) => repo.getListWord(db, id);
  const inQueue = async (wordId: number, day: number) =>
    (await repo.reviewQueue(db, nextDay(dayStart, day), nextDay(dayEnd, day), 50)).items.some((i) => i.word.id === wordId);

  it('the fourth lapse makes a leech: it leaves review and shows on Home', async () => {
    const { wordId, cardId } = await learnedWord();
    const results = [];
    for (let i = 1; i <= 4; i++) results.push((await grade(cardId, Rating.Again, nextDay(now, i * 3))).leech);
    expect(results).toEqual([false, false, false, true]);
    expect((await word(wordId)).leechAt).not.toBeNull();
    expect(await inQueue(wordId, 30)).toBe(false);
    expect((await repo.stats(db, dayStart, dayEnd)).leeches).toEqual([{ listId: MANGA, listName: 'Manga', count: 1 }]);
  });

  it('showing it a new way lets it back in, and each card then takes four more lapses of its own', async () => {
    const { wordId, cardId } = await learnedWord();
    const other = (await db.prepare(`SELECT id FROM cards WHERE word_id = ? AND direction = 'en_jp'`).bind(wordId).first<{ id: number }>())!.id;
    await grade(other, Rating.Again, nextDay(now, 2));
    for (let i = 1; i <= 4; i++) await grade(cardId, Rating.Again, nextDay(now, i * 3));
    const leech = await word(wordId);
    // Saving it unchanged, clearing a hook or moving it is no new approach.
    for (const changes of [{ coreMeaning: leech.coreMeaning }, { hook: null }, { listId: BOOKS }]) {
      expect((await repo.updateWord(db, wordId, changes, now)).leechAt).not.toBeNull();
    }
    await expect(repo.updateWord(db, wordId, { hook: 'nu-keru: a nut falls out' }, now)).resolves.toMatchObject({ leechAt: null });
    expect(await inQueue(wordId, 30)).toBe(true);
    // The other card had one lapse before: it takes four more, not four minus one or seven.
    const again = [];
    for (let i = 5; i <= 8; i++) again.push((await grade(other, Rating.Again, nextDay(now, i * 3))).leech);
    expect(again).toEqual([false, false, false, true]);
    await expect(repo.updateWord(db, wordId, { coreMeaning: 'to come out (of a socket)' }, now)).resolves.toMatchObject({ leechAt: null });
  });

  it('a set-aside leech is no leech, and comes back to review with its lapses counted afresh', async () => {
    const { wordId, cardId } = await learnedWord();
    for (let i = 1; i <= 4; i++) await grade(cardId, Rating.Again, nextDay(now, i * 3));
    expect((await repo.setAside(db, wordId, now)).leechAt).toBeNull();
    expect((await repo.stats(db, dayStart, dayEnd)).leeches).toEqual([]);
    expect((await repo.bringBack(db, wordId, now)).status).toBe('graduated');
    expect(await inQueue(wordId, 30)).toBe(true);
    expect((await grade(cardId, Rating.Again, nextDay(now, 30))).leech).toBe(false);
  });

  it('a word waiting for a fresh page, set aside and brought back, is no leech on its next lapse', async () => {
    const { wordId, cardId } = await learnedWord();
    for (let i = 1; i <= 4; i++) await grade(cardId, Rating.Again, nextDay(now, i * 3));
    await repo.relearn(db, wordId, now);
    await repo.setAside(db, wordId, now);
    expect((await repo.bringBack(db, wordId, now)).status).toBe('graduated');
    expect((await grade(cardId, Rating.Again, nextDay(now, 30))).leech).toBe(false);
  });

  it('a fresh page: first in line, off its old page, cards start afresh with their history', async () => {
    const { wordId, cardId, pageId } = await learnedWord();
    for (let i = 1; i <= 4; i++) await grade(cardId, Rating.Again, nextDay(now, i * 3));
    await importAndSort(0, 3);
    const moved = await repo.relearn(db, wordId, now);
    expect(moved).toMatchObject({ status: 'inbox', leechAt: null, page: null });
    expect((await repo.getPage(db, pageId)).words).toHaveLength(0);
    await expect(repo.relearn(db, wordId, now)).rejects.toMatchObject({ status: 409 });

    const page = await repo.createPage(db, 2, MANGA, now);
    expect(page.words[0].id).toBe(wordId);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    await repo.completeStage(db, page.id, 'shuffled', dayEnd, now);
    const card = await db.prepare(`SELECT id, lapses FROM cards WHERE word_id = ? AND direction = 'jp_en'`).bind(wordId).first<{ id: number; lapses: number }>();
    expect(card).toEqual({ id: cardId, lapses: 0 });
    const logs = await db.prepare('SELECT kind, COUNT(*) AS n FROM review_log WHERE card_id = ? GROUP BY kind ORDER BY kind').bind(cardId).all<{ kind: string; n: number }>();
    expect(logs.results).toEqual([
      { kind: 'graduation', n: 2 },
      { kind: 'review', n: 4 },
    ]);
    // Graduating again changes nothing, though its cards already existed.
    await repo.completeStage(db, page.id, 'shuffled', dayEnd, now);
    const after = await db.prepare(`SELECT COUNT(*) AS n FROM review_log WHERE kind = 'graduation'`).first<{ n: number }>();
    expect(after?.n).toBe(2 + 2 * 2);
    // Due again (the reviews above were dated up to day 12).
    expect(await inQueue(wordId, 20)).toBe(true);
  });

  it('a memory hook is kept, trimmed and limited', async () => {
    const { wordId } = await learnedWord();
    expect((await repo.updateWord(db, wordId, { hook: '  nu-keru: a nut falls out  ' }, now)).hook).toBe('nu-keru: a nut falls out');
    expect((await repo.updateWord(db, wordId, { hook: '' }, now)).hook).toBeNull();
    await expect(repo.updateWord(db, wordId, { hook: 'x'.repeat(301) }, now)).rejects.toMatchObject({ status: 400 });
    await expect(repo.updateWord(db, wordId, { hook: 5 }, now)).rejects.toMatchObject({ status: 400 });
  });
});

describe('review', () => {
  it('records a review, reschedules the card and buries the sibling for the day', async () => {
    await importAndSort(0, 1);
    const page = await repo.createPage(db, 10, null, now);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    await repo.completeStage(db, page.id, 'shuffled', dayEnd, now);

    const t = new Date('2026-10-26T19:00:00Z');
    const q = await repo.reviewQueue(db, dayEnd, nextDay(dayEnd, 1), 50);
    expect(q.total).toBe(1);
    const result = await repo.submitReview(db, { cardId: q.items[0].cardId, rating: Rating.Good, hintUsed: false, answer: null, correct: null, durationMs: 4000 }, t);
    expect(new Date(result.due).getTime()).toBeGreaterThan(t.getTime() + 86_400_000);
    expect((await repo.reviewQueue(db, dayEnd, nextDay(dayEnd, 1), 50)).total).toBe(0);
  });

  it('a retried answer that already got through is counted once', async () => {
    await importAndSort(0, 1);
    const page = await repo.createPage(db, 10, null, now);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    await repo.completeStage(db, page.id, 'shuffled', dayEnd, now);
    const t = new Date('2026-10-26T19:00:00Z');
    const [item] = (await repo.reviewQueue(db, dayEnd, nextDay(dayEnd, 1), 50)).items;
    const input = { cardId: item.cardId, rating: Rating.Good as const, hintUsed: false, answer: null, correct: null, durationMs: 4000, due: item.due };
    const first = await repo.submitReview(db, input, t);
    const again = await repo.submitReview(db, input, new Date(t.getTime() + 20_000));
    expect(again.due).toBe(first.due);
    const logs = await db.prepare(`SELECT COUNT(*) AS n FROM review_log WHERE card_id = ? AND kind = 'review'`).bind(item.cardId).first<{ n: number }>();
    expect(logs!.n).toBe(1);
  });

  it('two grades racing for one card count once', async () => {
    await importAndSort(0, 1);
    const page = await repo.createPage(db, 10, null, now);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    await repo.completeStage(db, page.id, 'shuffled', dayEnd, now);
    const t = new Date('2026-10-26T19:00:00Z');
    const [item] = (await repo.reviewQueue(db, dayEnd, nextDay(dayEnd, 1), 50)).items;
    const input = { cardId: item.cardId, rating: Rating.Good as const, hintUsed: false, answer: null, correct: null, durationMs: null };
    const [a, b] = await Promise.all([repo.submitReview(db, input, t), repo.submitReview(db, input, t)]);
    expect(a.due).toBe(b.due);
    const logs = await db.prepare(`SELECT COUNT(*) AS n FROM review_log WHERE card_id = ? AND kind = 'review'`).bind(item.cardId).first<{ n: number }>();
    expect(logs!.n).toBe(1);
  });

  it('a hint caps the stored rating at Hard', async () => {
    await importAndSort(0, 1);
    const page = await repo.createPage(db, 10, null, now);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    await repo.completeStage(db, page.id, 'shuffled', dayEnd, now);
    const q = await repo.reviewQueue(db, dayEnd, nextDay(dayEnd, 1), 50);
    const r = await repo.submitReview(db, { cardId: q.items[0].cardId, rating: Rating.Easy, hintUsed: true, answer: null, correct: null, durationMs: null }, now);
    expect(r.rating).toBe(Rating.Hard);
  });

  it('sends the interval each grade would give, without jitter', async () => {
    await importAndSort(0, 1);
    const page = await repo.createPage(db, 10, null, now);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    await repo.completeStage(db, page.id, 'shuffled', dayEnd, now);
    const t = new Date('2026-10-26T19:00:00Z');
    const q = await repo.reviewQueue(db, dayEnd, nextDay(dayEnd, 1), 50, t);
    const { again, hard, good, easy } = q.items[0].intervals;
    expect(again).toBeGreaterThan(0);
    expect(again).toBeLessThan(hard);
    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThan(easy);
    // No jitter: the jitter's seed changes with the time, the preview doesn't.
    const later = (await repo.reviewQueue(db, dayEnd, nextDay(dayEnd, 1), 50, new Date(t.getTime() + 1))).items[0].intervals;
    for (const k of ['again', 'hard', 'good', 'easy'] as const) expect(Math.abs(later[k] - q.items[0].intervals[k])).toBeLessThan(1e-6);
    // Grading Good lands within the jitter of what the button showed (FSRS
    // fuzzes a week by about two days either way).
    const result = await repo.submitReview(db, { cardId: q.items[0].cardId, rating: Rating.Good, hintUsed: false, answer: null, correct: null, durationMs: null }, t);
    const days = (new Date(result.due).getTime() - t.getTime()) / 86_400_000;
    expect(good).toBeLessThan(10);
    expect(Math.abs(days - good)).toBeLessThanOrEqual(2.5);
  });

  it('caps new production cards at 10 a day', async () => {
    await importAndSort(25, 0);
    const q = await repo.reviewQueue(db, dayStart, dayEnd, 50);
    expect(q.total).toBe(10);
    expect(q.items.every((i) => i.direction === 'en_jp')).toBe(true);
  });
});

describe('new words a day', () => {
  it('defaults to 12, is shared by devices and refuses odd values', async () => {
    expect(await repo.getStudy(db)).toEqual({ newWordsPerDay: 12, showIntervals: true });
    expect(await repo.setStudy(db, { newWordsPerDay: 20 }, now)).toEqual({ newWordsPerDay: 20, showIntervals: true });
    // Each setting changes on its own.
    expect(await repo.setStudy(db, { showIntervals: false }, now)).toEqual({ newWordsPerDay: 20, showIntervals: false });
    expect((await repo.stats(db, dayStart, dayEnd)).newWordsPerDay).toBe(20);
    for (const bad of [0, 51, 2.5, 'ten', '8', true, [8], null] as unknown[]) {
      await expect(repo.setStudy(db, { newWordsPerDay: bad as number }, now)).rejects.toMatchObject({ status: 400 });
    }
    await expect(repo.setStudy(db, null, now)).rejects.toMatchObject({ status: 400 });
    await expect(repo.setStudy(db, {}, now)).rejects.toMatchObject({ status: 400 });
    await expect(repo.setStudy(db, { showIntervals: 'no' as never }, now)).rejects.toMatchObject({ status: 400 });
    expect(await repo.getStudy(db)).toEqual({ newWordsPerDay: 20, showIntervals: false });
  });

  it('counts the words on pages started today', async () => {
    await importAndSort(0, 15);
    await repo.createPage(db, 10, null, nextDay(now, -1));
    expect((await repo.stats(db, dayStart, dayEnd)).newWordsToday).toBe(0);
    const today = await repo.createPage(db, 4, null, now);
    expect((await repo.stats(db, dayStart, dayEnd)).newWordsToday).toBe(4);
    // Deleting it gives the room back: its words wait again.
    await repo.deletePage(db, today.id, now);
    expect((await repo.stats(db, dayStart, dayEnd)).newWordsToday).toBe(0);
  });
});

describe('editing', () => {
  it('updates the core meaning and rejects an empty one', async () => {
    await repo.importWords(db, words, MANGA, now);
    const { words: [w] } = await repo.triageNext(db, 1);
    expect((await repo.updateWord(db, w.id, { coreMeaning: '  rescue ' }, now)).coreMeaning).toBe('rescue');
    await expect(repo.updateWord(db, w.id, { coreMeaning: ' ' }, now)).rejects.toMatchObject({ status: 400 });
  });
});

describe('furigana prefs and hints', () => {
  const later = nextDay(now, 1);

  it('starts from defaults and stores cleaned prefs', async () => {
    expect(await repo.getFurigana(db)).toEqual({ prefs: { kanjiLevel: 'n4', knownKanji: '', learningKanji: '' }, stored: false });
    const saved = await repo.setFurigana(db, { kanjiLevel: 'n5', knownKanji: '誰 必 誰x', learningKanji: '' }, now);
    expect(saved.prefs).toEqual({ kanjiLevel: 'n5', knownKanji: '誰必', learningKanji: '' });
    expect(await repo.getFurigana(db)).toEqual(saved);
    await expect(repo.setFurigana(db, { kanjiLevel: 'n3' as 'n4' }, now)).rejects.toThrow('kanjiLevel');
  });

  it('a kanji peeked at twice moves to still learning; marking it known again starts over', async () => {
    await repo.importWords(db, words, MANGA, now);
    const [a, b] = (await repo.triageNext(db, 2)).words;
    const first = await repo.recordFuriganaHint(db, a.id, '時代', now);
    expect(first.movedToLearning).toBe('');
    const second = await repo.recordFuriganaHint(db, b.id, '時', later);
    expect(second.movedToLearning).toBe('時');
    expect(second.prefs.learningKanji).toBe('時');
    // 代 was peeked at only once.
    expect((await repo.getFurigana(db)).prefs.learningKanji).toBe('時');

    // Back to known: old peeks no longer count, so one new peek doesn't move it.
    await repo.setFurigana(db, { ...second.prefs, learningKanji: '' }, later);
    expect((await repo.recordFuriganaHint(db, a.id, '時', later)).movedToLearning).toBe('');
  });

  it('only counts kanji you are meant to know', async () => {
    await repo.importWords(db, words, MANGA, now);
    const [a] = (await repo.triageNext(db, 1)).words;
    await repo.setFurigana(db, { kanjiLevel: 'n4', knownKanji: '', learningKanji: '験' }, now);
    await repo.recordFuriganaHint(db, a.id, '験', now);
    const again = await repo.recordFuriganaHint(db, a.id, '験', now);
    expect(again.movedToLearning).toBe('');
    expect(again.prefs.learningKanji).toBe('験');
  });

  it('refuses hints without kanji or for a missing word', async () => {
    await expect(repo.recordFuriganaHint(db, 1, 'かな', now)).rejects.toThrow('kanji');
    await expect(repo.recordFuriganaHint(db, 999, '時', now)).rejects.toThrow('word not found');
  });
});

describe('repeated and concurrent requests', () => {
  it('answering a word twice leaves one set of cards and reports it was already checked', async () => {
    await repo.importWords(db, words, MANGA, now);
    const [w] = (await repo.triageNext(db, 1)).words;
    const results = await Promise.allSettled([repo.triageAnswer(db, w.id, 'known', now), repo.triageAnswer(db, w.id, 'known', now)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const cards = await db.prepare('SELECT COUNT(*) AS n FROM cards WHERE word_id = ?').bind(w.id).first<{ n: number }>();
    expect(cards?.n).toBe(2);
  });

  it('graduating a page twice is harmless', async () => {
    await importAndSort(0, 3);
    const page = await repo.createPage(db, 3, null, now);
    await repo.completeStage(db, page.id, 'ordered', nextDay(dayStart, 1), now);
    const both = await Promise.all([
      repo.completeStage(db, page.id, 'shuffled', nextDay(dayStart, 1), now),
      repo.completeStage(db, page.id, 'shuffled', nextDay(dayStart, 1), now),
    ]);
    expect(both.map((p) => p.stage)).toEqual(['graduated', 'graduated']);
    const cards = await db.prepare('SELECT COUNT(*) AS n FROM cards').first<{ n: number }>();
    const logs = await db.prepare(`SELECT COUNT(*) AS n FROM review_log WHERE kind = 'graduation'`).first<{ n: number }>();
    expect(cards?.n).toBe(6);
    expect(logs?.n).toBe(6);
  });

  it('a failed page creation leaves no empty page behind', async () => {
    await importAndSort(0, 2);
    const inbox = (await db.prepare(`SELECT id FROM words WHERE status = 'inbox'`).all<{ id: number }>()).results;
    // Another page took one of these words a moment ago.
    await db.prepare(`INSERT INTO pages (number, stage, created_at) VALUES (7, 'ordered', ?)`).bind(now.toISOString()).run();
    await db.prepare('INSERT INTO page_words (page_id, word_id, position) VALUES ((SELECT id FROM pages WHERE number = 7), ?, 0)').bind(inbox[1].id).run();
    await expect(repo.createPage(db, 2, null, now)).rejects.toThrow('try again');
    expect((await repo.listPages(db)).map((p) => p.number)).toEqual([7]);
  });
});

describe('pages you shape', () => {
  const inboxIds = async () => (await db.prepare(`SELECT id FROM words WHERE status = 'inbox' ORDER BY source_order`).all<{ id: number }>()).results.map((r) => r.id);
  const status = async (id: number) => (await repo.getWord(db, id)).status;
  /**
   * The database, with `meanwhile` run just before the batch that makes the
   * change (after `reads` read-only batches): the other device changing
   * something after the checks.
   */
  const racing = (meanwhile: () => Promise<unknown>, reads = 0) => {
    let batches = 0;
    return new Proxy(db, {
      get: (target, key) =>
        key === 'batch'
          ? async (stmts: D1PreparedStatement[]) => {
              if (batches++ === reads) await meanwhile();
              return target.batch(stmts);
            }
          : (target as unknown as Record<string | symbol, unknown>)[key],
    });
  };
  const setAsideNow = (id: number) => () => db.prepare(`UPDATE words SET status = 'ignored' WHERE id = ?`).bind(id).run();

  it('builds a page from picked words, in the order picked, waiting or still to check', async () => {
    await importAndSort(0, 6);
    const waiting = await inboxIds();
    const toCheck = (await repo.triageNext(db, 1)).words[0].id;
    const picked = [waiting[4], toCheck, waiting[1]];
    const page = await repo.createPage(db, 12, null, now, picked);
    expect(page.words.map((w) => [w.id, w.position])).toEqual(picked.map((id, i) => [id, i]));
    expect(page.listId).toBe(MANGA);
    expect(page.words.every((w) => w.status === 'on_page')).toBe(true);
    expect((await repo.stats(db, dayStart, dayEnd)).inbox).toBe(4);
  });

  it('refuses picks that break a page', async () => {
    await importAndSort(1, 4);
    const waiting = await inboxIds();
    const learned = (await db.prepare(`SELECT id FROM words WHERE status = 'graduated'`).first<{ id: number }>())!.id;
    await expect(repo.createPage(db, 2, null, now, waiting.slice(0, 3))).rejects.toMatchObject({ status: 400 });
    await expect(repo.createPage(db, 12, null, now, [])).rejects.toMatchObject({ status: 400 });
    await expect(repo.createPage(db, 12, null, now, [waiting[0], waiting[0]])).rejects.toMatchObject({ status: 400 });
    await expect(repo.createPage(db, 12, null, now, [waiting[0], learned])).rejects.toMatchObject({ status: 409 });
    await expect(repo.createPage(db, 12, 3, now, [waiting[0]])).rejects.toThrow('another list');
    // A word from another list.
    await repo.updateWord(db, waiting[1], { listId: 3 }, now);
    await expect(repo.createPage(db, 12, null, now, [waiting[0], waiting[1]])).rejects.toThrow('one list');
    expect(await repo.listPages(db)).toEqual([]);
  });

  it('a picked word set aside in between leaves no page behind', async () => {
    await importAndSort(0, 3);
    const waiting = await inboxIds();
    await expect(repo.createPage(racing(setAsideNow(waiting[1]), 1), 12, null, now, waiting)).rejects.toThrow('try again');
    expect(await repo.listPages(db)).toEqual([]);
    expect(await status(waiting[0])).toBe('inbox');
  });

  it('swaps a word for the next waiting one, which takes its spot', async () => {
    await importAndSort(0, 5);
    const page = await repo.createPage(db, 3, null, now);
    const [, middle] = page.words;
    const next = (await inboxIds())[0];
    const swapped = await repo.changePageWord(db, page.id, { wordId: middle.id, replacement: 'next' }, now);
    expect(swapped.words.map((w) => w.id)).toEqual([page.words[0].id, next, page.words[2].id]);
    expect(swapped.words.map((w) => w.position)).toEqual([0, 1, 2]);
    expect(await status(middle.id)).toBe('inbox');
    expect(await status(next)).toBe('on_page');
    // The word taken off waits again, so it can be checked again too.
    expect((await repo.listWords(db, MANGA)).find((w) => w.id === middle.id)?.canCheckAgain).toBe(true);
  });

  it('swaps for a picked word and can set the old one aside', async () => {
    await importAndSort(0, 3);
    const page = await repo.createPage(db, 2, null, now);
    const toCheck = (await repo.triageNext(db, 1)).words[0].id;
    const swapped = await repo.changePageWord(db, page.id, { wordId: page.words[0].id, replacement: toCheck, setAside: true }, now);
    expect(swapped.words.map((w) => w.id)).toEqual([toCheck, page.words[1].id]);
    expect(await status(page.words[0].id)).toBe('ignored');
  });

  it('takes a word off and closes the gap, and adds one at the end', async () => {
    await importAndSort(0, 5);
    const page = await repo.createPage(db, 4, null, now);
    const fewer = await repo.changePageWord(db, page.id, { wordId: page.words[1].id, replacement: null }, now);
    expect(fewer.words.map((w) => w.id)).toEqual([page.words[0].id, page.words[2].id, page.words[3].id]);
    expect(fewer.words.map((w) => w.position)).toEqual([0, 1, 2]);
    const added = await repo.changePageWord(db, page.id, { wordId: null, replacement: page.words[1].id }, now);
    expect(added.words.map((w) => [w.id, w.position]).at(-1)).toEqual([page.words[1].id, 3]);
  });

  it('only changes words on a page in step 1, from its own list', async () => {
    await importAndSort(0, 4);
    const page = await repo.createPage(db, 1, null, now);
    const [other] = await inboxIds();
    await expect(repo.changePageWord(db, page.id, { wordId: page.words[0].id, replacement: null }, now)).rejects.toThrow('delete the page');
    await expect(repo.changePageWord(db, page.id, { wordId: other, replacement: 'next' }, now)).rejects.toMatchObject({ status: 404 });
    await expect(repo.changePageWord(db, page.id, { wordId: null, replacement: null }, now)).rejects.toMatchObject({ status: 400 });
    await repo.updateWord(db, other, { listId: 3 }, now);
    await expect(repo.changePageWord(db, page.id, { wordId: page.words[0].id, replacement: other }, now)).rejects.toThrow('one list');
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    await expect(repo.changePageWord(db, page.id, { wordId: page.words[0].id, replacement: 'next' }, now)).rejects.toThrow('step 1');
  });

  it('refuses "next" when nothing else is waiting', async () => {
    await importAndSort(0, 2);
    const page = await repo.createPage(db, 2, null, now);
    await expect(repo.changePageWord(db, page.id, { wordId: page.words[0].id, replacement: 'next' }, now)).rejects.toThrow('no other words');
    expect((await repo.getPage(db, page.id)).words).toHaveLength(2);
  });

  it('a replacement taken in between changes nothing', async () => {
    await importAndSort(0, 3);
    const page = await repo.createPage(db, 2, null, now);
    const [next] = await inboxIds();
    await expect(repo.changePageWord(racing(setAsideNow(next)), page.id, { wordId: page.words[0].id, replacement: next }, now)).rejects.toThrow('try again');
    expect((await repo.getPage(db, page.id)).words.map((w) => w.id)).toEqual(page.words.map((w) => w.id));
    expect(await status(page.words[0].id)).toBe('on_page');
  });

  it('a word taken off on the other device in between: a swap of a later word still lands in its spot', async () => {
    await importAndSort(0, 6);
    const page = await repo.createPage(db, 4, null, now);
    const [first, , , last] = page.words;
    const [next] = await inboxIds();
    const takeOffFirst = () => repo.changePageWord(db, page.id, { wordId: first.id, replacement: null }, now);
    const swapped = await repo.changePageWord(racing(takeOffFirst), page.id, { wordId: last.id, replacement: next, setAside: true }, now);
    expect(swapped.words.map((w) => [w.id, w.position])).toEqual([
      [page.words[1].id, 0],
      [page.words[2].id, 1],
      [next, 2],
    ]);
    expect(await status(last.id)).toBe('ignored');
  });

  it('a swap of a word already taken off on the other device changes nothing', async () => {
    await importAndSort(0, 6);
    const page = await repo.createPage(db, 3, null, now);
    const [next] = await inboxIds();
    const takeOff = () => repo.changePageWord(db, page.id, { wordId: page.words[2].id, replacement: null }, now);
    await expect(repo.changePageWord(racing(takeOff), page.id, { wordId: page.words[2].id, replacement: next }, now)).rejects.toThrow('reload');
    expect((await repo.getPage(db, page.id)).words.map((w) => w.id)).toEqual(page.words.slice(0, 2).map((w) => w.id));
    expect(await status(next)).toBe('inbox');
  });

  it('adding after a word was taken off on the other device leaves no gap', async () => {
    await importAndSort(0, 6);
    const page = await repo.createPage(db, 3, null, now);
    const [next] = await inboxIds();
    const takeOff = () => repo.changePageWord(db, page.id, { wordId: page.words[0].id, replacement: null }, now);
    const added = await repo.changePageWord(racing(takeOff), page.id, { wordId: null, replacement: next }, now);
    expect(added.words.map((w) => w.position)).toEqual([0, 1, 2]);
    expect(added.words.at(-1)?.id).toBe(next);
  });

  it('removing a word whose spot moved on the other device changes nothing', async () => {
    await importAndSort(0, 6);
    const page = await repo.createPage(db, 4, null, now);
    const takeOffFirst = () => repo.changePageWord(db, page.id, { wordId: page.words[0].id, replacement: null }, now);
    await expect(repo.changePageWord(racing(takeOffFirst), page.id, { wordId: page.words[3].id, replacement: null }, now)).rejects.toThrow('reload');
    const after = await repo.getPage(db, page.id);
    expect(after.words.map((w) => [w.id, w.position])).toEqual(page.words.slice(1).map((w, i) => [w.id, i]));
    expect(await status(page.words[3].id)).toBe('on_page');
  });

  it('a page that moved on to step 2 in between keeps its words', async () => {
    await importAndSort(0, 3);
    const page = await repo.createPage(db, 2, null, now);
    const step2 = () => repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    await expect(repo.changePageWord(racing(step2), page.id, { wordId: page.words[0].id, replacement: null }, now)).rejects.toMatchObject({ status: 409 });
    const after = await repo.getPage(db, page.id);
    expect(after.words.map((w) => [w.id, w.position])).toEqual(page.words.map((w) => [w.id, w.position]));
    expect(await status(page.words[0].id)).toBe('on_page');
  });

  it('a page graduated in between is not deleted as unfinished', async () => {
    await importAndSort(0, 2);
    const page = await repo.createPage(db, 2, null, now);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    const graduate = () => repo.completeStage(db, page.id, 'shuffled', dayEnd, now);
    await expect(repo.deletePage(racing(graduate), page.id, now)).rejects.toMatchObject({ status: 409 });
    const after = await repo.getPage(db, page.id);
    expect(after.stage).toBe('graduated');
    expect(after.words).toHaveLength(2);
  });

  it('deleting an unfinished page sends its words back to waiting', async () => {
    await importAndSort(0, 3);
    const page = await repo.createPage(db, 3, null, now);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    await repo.deletePage(db, page.id, now);
    expect(await repo.listPages(db)).toEqual([]);
    expect(await inboxIds()).toHaveLength(3);
    await expect(repo.getPage(db, page.id)).rejects.toMatchObject({ status: 404 });
    // The words can go on a new page again.
    expect((await repo.createPage(db, 3, null, now)).words).toHaveLength(3);
  });

  it('deleting a learned page keeps its words in review with their history', async () => {
    await importAndSort(0, 2);
    const page = await repo.createPage(db, 2, null, now);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    await repo.completeStage(db, page.id, 'shuffled', dayEnd, now);
    await repo.deletePage(db, page.id, now);
    expect(await repo.listPages(db)).toEqual([]);
    for (const w of page.words) expect(await status(w.id)).toBe('graduated');
    const cards = await db.prepare('SELECT COUNT(*) AS n FROM cards').first<{ n: number }>();
    const logs = await db.prepare(`SELECT COUNT(*) AS n FROM review_log WHERE kind = 'graduation'`).first<{ n: number }>();
    expect([cards?.n, logs?.n]).toEqual([4, 4]);
    const tomorrow = await repo.reviewQueue(db, dayEnd, nextDay(dayEnd, 1), 50);
    expect(tomorrow.total).toBe(2);
    expect(tomorrow.items[0].page).toBeNull();
  });
});

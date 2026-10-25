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

let db: D1Database;
beforeEach(() => {
  db = createTestDb();
});

async function importAndSort(known: number, unknown: number) {
  await repo.importWords(db, words, 'manga', now);
  const { words: batch } = await repo.triageNext(db, known + unknown);
  for (const w of batch.slice(0, known)) await repo.triageAnswer(db, w.id, 'known', now);
  for (const w of batch.slice(known, known + unknown)) await repo.triageAnswer(db, w.id, 'unknown', now);
  return batch;
}

describe('import', () => {
  it('adds words as unverified and skips duplicates on re-import', async () => {
    expect(await repo.importWords(db, words, 'manga', now)).toEqual({ added: 48, duplicates: 0 });
    expect(await repo.importWords(db, words, 'manga', now)).toEqual({ added: 0, duplicates: 48 });
    const s = await repo.stats(db, dayStart, dayEnd);
    expect(s).toMatchObject({ toCheck: 48, inbox: 0, learned: 0, reviewsDue: 0 });
  });

  it('stores a short core meaning next to the full senses', async () => {
    await repo.importWords(db, words, 'manga', now);
    const { words: list } = await repo.triageNext(db, 50);
    const toru = list.find((w) => w.kanji === '助ける')!;
    expect(toru.coreMeaning).toBe('to save, to rescue, to spare');
    expect(toru.senses.length).toBeGreaterThan(1);
    expect(toru.sourceList).toBe('manga');
  });
});

describe('triage', () => {
  it('goes from lowest mastery up', async () => {
    await repo.importWords(db, words, 'manga', now);
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
    await repo.importWords(db, words, 'manga', now);
    const { words: list } = await repo.triageNext(db, 2);
    await repo.triageAnswer(db, list[0].id, 'unknown', now);
    await repo.triageAnswer(db, list[1].id, 'ignore', now);
    expect((await repo.getWord(db, list[0].id)).status).toBe('inbox');
    expect((await repo.getWord(db, list[1].id)).status).toBe('ignored');
    await expect(repo.triageAnswer(db, list[0].id, 'known', now)).rejects.toMatchObject({ status: 409 });
  });
});

describe('pages', () => {
  it('builds a page from the inbox in source order and keeps positions', async () => {
    const sorted = await importAndSort(0, 12);
    const page = await repo.createPage(db, 10, now);
    expect(page.number).toBe(1);
    expect(page.stage).toBe('ordered');
    expect(page.words.map((w) => w.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const inSourceOrder = sorted.slice().sort((a, b) => words.findIndex((x) => x.kana === a.kana && x.kanji === a.kanji) - words.findIndex((x) => x.kana === b.kana && x.kanji === b.kanji));
    expect(page.words.map((w) => w.id)).toEqual(inSourceOrder.slice(0, 10).map((w) => w.id));
    expect((await repo.stats(db, dayStart, dayEnd)).inbox).toBe(2);
  });

  it('refuses an empty inbox', async () => {
    await expect(repo.createPage(db, 10, now)).rejects.toMatchObject({ status: 409 });
  });

  it('graduates after both stages; reviews start the next day', async () => {
    await importAndSort(0, 3);
    const page = await repo.createPage(db, 10, now);
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

describe('review', () => {
  it('records a review, reschedules the card and buries the sibling for the day', async () => {
    await importAndSort(0, 1);
    const page = await repo.createPage(db, 10, now);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    await repo.completeStage(db, page.id, 'shuffled', dayEnd, now);

    const t = new Date('2026-10-26T19:00:00Z');
    const q = await repo.reviewQueue(db, dayEnd, nextDay(dayEnd, 1), 50);
    expect(q.total).toBe(1);
    const result = await repo.submitReview(db, { cardId: q.items[0].cardId, rating: Rating.Good, hintUsed: false, answer: null, correct: null, durationMs: 4000 }, t);
    expect(new Date(result.due).getTime()).toBeGreaterThan(t.getTime() + 86_400_000);
    expect((await repo.reviewQueue(db, dayEnd, nextDay(dayEnd, 1), 50)).total).toBe(0);
  });

  it('a hint caps the stored rating at Hard', async () => {
    await importAndSort(0, 1);
    const page = await repo.createPage(db, 10, now);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    await repo.completeStage(db, page.id, 'shuffled', dayEnd, now);
    const q = await repo.reviewQueue(db, dayEnd, nextDay(dayEnd, 1), 50);
    const r = await repo.submitReview(db, { cardId: q.items[0].cardId, rating: Rating.Easy, hintUsed: true, answer: null, correct: null, durationMs: null }, now);
    expect(r.rating).toBe(Rating.Hard);
  });

  it('caps new production cards at 20 a day', async () => {
    await importAndSort(25, 0);
    const q = await repo.reviewQueue(db, dayStart, dayEnd, 50);
    expect(q.total).toBe(20);
    expect(q.items.every((i) => i.direction === 'en_jp')).toBe(true);
  });
});

describe('editing', () => {
  it('updates the core meaning and rejects an empty one', async () => {
    await repo.importWords(db, words, 'manga', now);
    const { words: [w] } = await repo.triageNext(db, 1);
    expect((await repo.updateCoreMeaning(db, w.id, '  rescue ', now)).coreMeaning).toBe('rescue');
    await expect(repo.updateCoreMeaning(db, w.id, ' ', now)).rejects.toMatchObject({ status: 400 });
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
    await repo.importWords(db, words, 'manga', now);
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
    await repo.importWords(db, words, 'manga', now);
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
    await repo.importWords(db, words, 'manga', now);
    const [w] = (await repo.triageNext(db, 1)).words;
    const results = await Promise.allSettled([repo.triageAnswer(db, w.id, 'known', now), repo.triageAnswer(db, w.id, 'known', now)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const cards = await db.prepare('SELECT COUNT(*) AS n FROM cards WHERE word_id = ?').bind(w.id).first<{ n: number }>();
    expect(cards?.n).toBe(2);
  });

  it('graduating a page twice is harmless', async () => {
    await importAndSort(0, 3);
    const page = await repo.createPage(db, 3, now);
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
    await expect(repo.createPage(db, 2, now)).rejects.toThrow('try again');
    expect((await repo.listPages(db)).map((p) => p.number)).toEqual([7]);
  });
});

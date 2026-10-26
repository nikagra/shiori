import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { effectiveWeight, FOCUS_BOOST, pickList, shareNewCards, type PageCandidate } from '../shared/lists';
import { buildQueue, type QueueCandidate } from '../shared/queue';
import { parseRenshuuExport } from '../shared/renshuu';
import { Rating, State } from '../shared/scheduler';
import * as repo from '../worker/db';
import { createTestDb } from './d1';

const root = join(import.meta.dirname, '..');
const words = parseRenshuuExport(readFileSync(join(root, 'test', 'fixtures', 'renshuu_custom_sample.txt'), 'utf8')).words;

const now = new Date('2026-10-25T20:00:00Z');
const dayStart = new Date('2026-10-25T03:00:00Z');
const dayEnd = new Date('2026-10-26T03:00:00Z');
const days = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

// The starting lists, in order.
const MANGA = 1;
const BOOKS = 2;
const SCHOOL = 3;

describe('sharing new cards between lists', () => {
  const share = (total: number, lists: [key: number, weight: number, introduced: number, available: number][]) =>
    Object.fromEntries(shareNewCards(total, lists.map(([key, weight, introduced, available]) => ({ key, weight, introduced, available }))));

  it('splits by weight', () => {
    expect(share(20, [[1, 1, 0, 50], [2, 4, 0, 50]])).toEqual({ 1: 4, 2: 16 });
    expect(share(20, [[1, 2, 0, 50], [2, 2, 0, 50]])).toEqual({ 1: 10, 2: 10 });
  });

  it('hands the share of a list that runs out to the others', () => {
    expect(share(20, [[1, 1, 0, 50], [2, 4, 0, 3]])).toEqual({ 1: 17, 2: 3 });
  });

  it('counts what each list already had today', () => {
    expect(share(20, [[1, 1, 0, 50], [2, 1, 10, 50]])).toEqual({ 1: 10, 2: 0 });
    expect(share(20, [[1, 1, 15, 50], [2, 1, 5, 50]])).toEqual({ 1: 0, 2: 0 });
  });

  it('gives nothing to a list with no weight (paused or archived)', () => {
    expect(share(20, [[1, 0, 0, 50], [2, 1, 0, 5]])).toEqual({ 1: 0, 2: 5 });
  });

  it('boosts a focused list and silences a paused one', () => {
    const pace = { weight: 2, paused: false, archived: false, focused: false };
    expect(effectiveWeight(pace)).toBe(2);
    expect(effectiveWeight({ ...pace, focused: true })).toBe(2 * FOCUS_BOOST);
    expect(effectiveWeight({ ...pace, focused: true, paused: true })).toBe(0);
    expect(effectiveWeight({ ...pace, archived: true })).toBe(0);
  });

  it('builds the queue with each list getting its share, in due order', () => {
    const fresh = (cardId: number, listId: number): QueueCandidate => ({
      cardId,
      wordId: cardId,
      direction: 'en_jp',
      state: State.New,
      due: `2026-10-${String(cardId).padStart(2, '0')}`,
      listId,
    });
    const cards = [1, 2, 3, 4, 5, 6].map((i) => fresh(i, MANGA)).concat([7, 8, 9].map((i) => fresh(i, SCHOOL)));
    const q = buildQueue(cards, {
      reviewedToday: new Set(),
      newIntroducedToday: new Map(),
      newPerDay: 4,
      weights: new Map([
        [MANGA, 1],
        [SCHOOL, 3],
      ]),
    });
    expect(q.map((c) => c.cardId)).toEqual([1, 7, 8, 9]);
  });
});

describe('picking a list for a new page', () => {
  const list = (id: number, over: Partial<PageCandidate> = {}): PageCandidate => ({
    id,
    weight: 2,
    paused: false,
    archived: false,
    focused: false,
    inbox: 10,
    pagesPerWeek: null,
    pagesThisWeek: 0,
    pagesRecent: 0,
    ...over,
  });

  it('takes the list with the fewest recent pages for its weight', () => {
    expect(pickList([list(1, { pagesRecent: 4 }), list(2, { pagesRecent: 1 })])).toBe(2);
    expect(pickList([list(1, { pagesRecent: 4, weight: 4 }), list(2, { pagesRecent: 3 })])).toBe(1);
  });

  it('puts a list behind its weekly target first, and a focused list before that', () => {
    const school = list(2, { pagesPerWeek: 1, pagesRecent: 9, weight: 1 });
    expect(pickList([list(1), school])).toBe(2);
    expect(pickList([list(1), { ...school, pagesThisWeek: 1 }])).toBe(1);
    expect(pickList([list(1, { focused: true, pagesRecent: 20 }), school])).toBe(1);
  });

  it('skips paused and archived lists and lists with nothing waiting', () => {
    expect(pickList([list(1, { paused: true }), list(2, { archived: true }), list(3, { inbox: 0 }), list(4, { pagesRecent: 50 })])).toBe(4);
    expect(pickList([list(1, { paused: true, focused: true })])).toBeNull();
  });
});

describe('lists in the database', () => {
  let db: D1Database;
  beforeEach(() => {
    db = createTestDb();
  });

  const lists = () => repo.listLists(db, dayStart, dayEnd, now);
  const byName = async (name: string) => (await lists()).find((l) => l.name === name)!;

  /** Imports words into a list and sends them to the inbox, or to review when known. */
  async function addWords(listId: number, from: number, count: number, result: 'known' | 'unknown' = 'unknown') {
    await repo.importWords(db, words.slice(from, from + count), listId, now);
    for (const w of (await db.prepare(`SELECT id FROM words WHERE list_id = ? AND status = 'unverified'`).bind(listId).all<{ id: number }>()).results) {
      await repo.triageAnswer(db, w.id, result, now);
    }
  }

  it('starts with Manga, Books, School and Other', async () => {
    expect((await lists()).map((l) => [l.name, l.weight, l.paused, l.archived])).toEqual([
      ['Manga', 2, false, false],
      ['Books', 2, false, false],
      ['School', 2, false, false],
      ['Other', 2, false, false],
    ]);
  });

  it('creates and renames lists, with names unique regardless of case', async () => {
    const { id } = await repo.createList(db, '  Yotsuba   vol 1 ', now);
    expect((await lists()).at(-1)).toMatchObject({ id, name: 'Yotsuba vol 1' });
    await expect(repo.createList(db, 'manga', now)).rejects.toThrow('already a list with that name');
    await expect(repo.createList(db, '  ', now)).rejects.toThrow('a list needs a name');
    await repo.updateList(db, id, { name: 'よつばと！' }, now);
    expect((await lists()).at(-1)!.name).toBe('よつばと！');
    await expect(repo.updateList(db, id, { name: 'School' }, now)).rejects.toThrow('already a list with that name');
  });

  it('checks weights, targets and flags', async () => {
    await repo.updateList(db, SCHOOL, { weight: 4, pagesPerWeek: 1, paused: true }, now);
    expect(await byName('School')).toMatchObject({ weight: 4, pagesPerWeek: 1, paused: true });
    await repo.updateList(db, SCHOOL, { pagesPerWeek: null, paused: false }, now);
    expect(await byName('School')).toMatchObject({ pagesPerWeek: null, paused: false });
    await expect(repo.updateList(db, SCHOOL, { weight: 0 }, now)).rejects.toThrow('weight must be');
    await expect(repo.updateList(db, SCHOOL, { pagesPerWeek: 2.5 }, now)).rejects.toThrow('pagesPerWeek');
    await expect(repo.updateList(db, SCHOOL, { paused: 'yes' }, now)).rejects.toThrow('paused must be');
    await expect(repo.updateList(db, 99, { weight: 2 }, now)).rejects.toThrow('list not found');
  });

  it('focuses one list at a time, until the date given', async () => {
    const until = days(now, 10).toISOString();
    await repo.updateList(db, MANGA, { focusUntil: until }, now);
    await repo.updateList(db, SCHOOL, { focusUntil: until }, now);
    expect((await lists()).filter((l) => l.focused).map((l) => l.name)).toEqual(['School']);
    expect((await repo.listLists(db, days(dayStart, 11), days(dayEnd, 11), days(now, 11))).some((l) => l.focused)).toBe(false);
    await expect(repo.updateList(db, SCHOOL, { focusUntil: days(now, -1).toISOString() }, now)).rejects.toThrow('in the future');
    await repo.updateList(db, SCHOOL, { focusUntil: null }, now);
    expect((await lists()).some((l) => l.focused)).toBe(false);
  });

  it('builds each page from one list, picking the one behind its pace', async () => {
    await addWords(MANGA, 0, 15);
    await addWords(SCHOOL, 20, 8);
    // School wants a page a week, so it goes first even though Manga has more waiting.
    await repo.updateList(db, SCHOOL, { pagesPerWeek: 1 }, now);
    expect((await lists()).find((l) => l.next)!.name).toBe('School');
    const first = await repo.createPage(db, 12, null, now);
    expect(first).toMatchObject({ listId: SCHOOL, listName: 'School', wordCount: 8 });
    expect(first.words.every((w) => w.listId === SCHOOL)).toBe(true);
    // Target met and nothing left there: Manga next.
    const second = await repo.createPage(db, 12, null, now);
    expect(second).toMatchObject({ listId: MANGA, wordCount: 12 });
    expect((await repo.listPages(db)).map((p) => p.listName)).toEqual(['Manga', 'School']);
    expect((await byName('School')).pagesThisWeek).toBe(1);
  });

  it('lets you pick the list, but not an archived one or one with nothing waiting', async () => {
    await addWords(MANGA, 0, 5);
    await addWords(BOOKS, 10, 5);
    expect((await repo.createPage(db, 10, BOOKS, now)).listId).toBe(BOOKS);
    await expect(repo.createPage(db, 10, BOOKS, now)).rejects.toThrow('no words from that list');
    await repo.updateList(db, MANGA, { archived: true }, now);
    await expect(repo.createPage(db, 10, MANGA, now)).rejects.toThrow('archived');
    await expect(repo.createPage(db, 10, 99, now)).rejects.toThrow('list not found');
  });

  it('asks you to pick when every list with words waiting is paused', async () => {
    await addWords(MANGA, 0, 5);
    await repo.updateList(db, MANGA, { paused: true }, now);
    expect((await lists()).some((l) => l.next)).toBe(false);
    await expect(repo.createPage(db, 10, null, now)).rejects.toThrow('paused; pick one');
    expect((await repo.createPage(db, 10, MANGA, now)).listId).toBe(MANGA);
    await expect(repo.createPage(db, 10, null, now)).rejects.toThrow('no words waiting');
  });

  it('splits new review cards by weight; a paused list gets none but its due reviews still come', async () => {
    // Known words start with a reviewed reading card and a new production card.
    await addWords(MANGA, 0, 20, 'known');
    await addWords(SCHOOL, 20, 20, 'known');
    await repo.updateList(db, SCHOOL, { weight: 4 }, now);
    await repo.updateList(db, MANGA, { weight: 1 }, now);
    const at = (n: number) => repo.listLists(db, days(dayStart, n), days(dayEnd, n), days(now, n));
    const split = (await at(0)).map((l) => [l.name, l.newToday]).filter(([, n]) => n);
    expect(split).toEqual([
      ['Manga', 4],
      ['School', 16],
    ]);
    await repo.updateList(db, SCHOOL, { paused: true }, now);
    expect((await at(0)).map((l) => [l.name, l.newToday]).filter(([, n]) => n)).toEqual([['Manga', 20]]);
    const later = await repo.reviewQueue(db, days(dayStart, 30), days(dayEnd, 30), 500);
    const schoolDue = later.items.filter((i) => i.word.listId === SCHOOL);
    expect(schoolDue.length).toBe(20);
    expect(schoolDue.every((i) => i.state !== State.New)).toBe(true);
  });

  it('counts new cards already met today against their own list', async () => {
    await addWords(MANGA, 0, 20, 'known');
    await addWords(SCHOOL, 20, 20, 'known');
    const q = await repo.reviewQueue(db, dayStart, dayEnd, 50);
    for (const item of q.items.filter((i) => i.word.listId === MANGA).slice(0, 10)) {
      await repo.submitReview(db, { cardId: item.cardId, rating: Rating.Good, hintUsed: false, answer: null, correct: null, durationMs: null }, now);
    }
    const left = (await lists()).map((l) => [l.name, l.newToday]).filter(([, n]) => n);
    expect(left).toEqual([['School', 10]]);
  });

  it('archiving hides a list from the check pass and the counts, and ends its focus', async () => {
    await repo.importWords(db, words.slice(0, 5), MANGA, now);
    await repo.importWords(db, words.slice(10, 13), SCHOOL, now);
    await repo.updateList(db, SCHOOL, { focusUntil: days(now, 3).toISOString() }, now);
    await repo.updateList(db, SCHOOL, { archived: true }, now);
    expect(await byName('School')).toMatchObject({ archived: true, focused: false, counts: { toCheck: 3 } });
    expect((await repo.triageNext(db, 50)).remaining).toBe(5);
    expect((await repo.stats(db, dayStart, dayEnd)).toCheck).toBe(5);
    await expect(repo.importWords(db, words.slice(20, 22), SCHOOL, now)).rejects.toThrow('archived');
    await expect(repo.updateList(db, SCHOOL, { focusUntil: days(now, 3).toISOString() }, now)).rejects.toThrow('archived');
    await repo.updateList(db, SCHOOL, { archived: false }, now);
    expect((await repo.triageNext(db, 50)).remaining).toBe(8);
  });

  it('merges a list into another, words and pages alike', async () => {
    await addWords(BOOKS, 0, 12);
    const page = await repo.createPage(db, 10, BOOKS, now);
    await repo.mergeList(db, BOOKS, MANGA, now);
    expect((await lists()).map((l) => l.name)).toEqual(['Manga', 'School', 'Other']);
    expect((await byName('Manga')).counts).toEqual({ toCheck: 0, inbox: 2, onPage: 10, learned: 0 });
    expect((await repo.getPage(db, page.id)).listName).toBe('Manga');
    await expect(repo.mergeList(db, MANGA, MANGA, now)).rejects.toThrow('into itself');
    await expect(repo.mergeList(db, BOOKS, MANGA, now)).rejects.toThrow('list not found');
  });

  it('deletes only a list with no words', async () => {
    await addWords(MANGA, 0, 2);
    await expect(repo.deleteList(db, MANGA)).rejects.toThrow('merge it into another list or archive it');
    await repo.deleteList(db, BOOKS);
    expect((await lists()).map((l) => l.name)).toEqual(['Manga', 'School', 'Other']);
  });

  it('imports by list name for an app that predates list ids', async () => {
    expect(await repo.listIdByName(db, 'school')).toBe(SCHOOL);
    await expect(repo.listIdByName(db, 'anime')).rejects.toThrow('no list called anime');
  });
});

describe('the lists migration on existing data', () => {
  it('makes a list per import label and puts every word and page on one', () => {
    const sqlite = new DatabaseSync(':memory:');
    const migration = (name: string) => sqlite.exec(readFileSync(join(root, 'migrations', `${name}.sql`), 'utf8'));
    migration('0001_init');
    migration('0002_furigana');
    const t = now.toISOString();
    const word = sqlite.prepare(
      `INSERT INTO words (kana, kanji, senses, core_meaning, source, source_list, source_order, status, created_at, updated_at)
       VALUES (?, NULL, '["x"]', 'x', 'renshuu', ?, ?, 'on_page', ?, ?)`,
    );
    ['manga', 'manga', 'school', null, ' Anime '].forEach((list, i) => word.run(`かな${i}`, list, i + 1, t, t));
    sqlite.exec(`INSERT INTO pages (number, stage, created_at) VALUES (1, 'ordered', '${t}')`);
    // A page from before lists could mix them: it takes the list most of its words share.
    [3, 1, 2].forEach((wordId, position) => sqlite.prepare('INSERT INTO page_words (page_id, word_id, position) VALUES (1, ?, ?)').run(wordId, position));
    migration('0003_lists');
    expect(sqlite.prepare('SELECT id, name FROM lists ORDER BY id').all().map((r) => `${r.id}:${r.name}`)).toEqual([
      '1:Manga',
      '2:Books',
      '3:School',
      '4:Other',
      '5:Anime',
    ]);
    expect(sqlite.prepare('SELECT list_id FROM words ORDER BY id').all().map((r) => r.list_id)).toEqual([1, 1, 3, 4, 5]);
    expect(sqlite.prepare('SELECT list_id FROM pages').get()!.list_id).toBe(1);
  });
});

describe('test reset', () => {
  it('leaves the starting lists, as after the migrations', async () => {
    const db = createTestDb();
    await repo.createList(db, 'Anime', now);
    await repo.resetAll(db);
    expect((await repo.listLists(db, dayStart, dayEnd, now)).map((l) => l.name)).toEqual(['Manga', 'Books', 'School', 'Other']);
  });
});

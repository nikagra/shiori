import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseRenshuuExport } from '../shared/renshuu';
import { Rating } from '../shared/scheduler';
import { filterWords, matchScore, countStates, type Searchable, type WordState } from '../shared/wordSearch';
import * as repo from '../worker/db';
import { createTestDb } from './d1';

const imported = parseRenshuuExport(readFileSync(join(import.meta.dirname, 'fixtures', 'renshuu_custom_sample.txt'), 'utf8')).words;

const now = new Date('2026-10-25T20:00:00Z');
const dayEnd = new Date('2026-10-26T03:00:00Z');

// The starting lists, in order.
const MANGA = 1;
const SCHOOL = 3;

const w = (kanji: string | null, kana: string, coreMeaning: string, status: WordState = 'inbox', senses = [coreMeaning]): Searchable => ({
  kanji,
  kana,
  coreMeaning,
  senses,
  status,
});

describe('word search', () => {
  const words = [
    w('食べる', 'たべる', 'to eat', 'graduated'),
    w('食べ物', 'たべもの', 'food', 'inbox'),
    w('偉大', 'いだい', 'great, grand', 'inbox'),
    w(null, 'コーヒー', 'coffee', 'unverified'),
    w('褒める', 'ほめる', 'to praise', 'inbox'),
    w('家', 'いえ', 'house, home', 'ignored', ['house, home', 'family']),
  ];
  const find = (text: string, states: WordState[] = []) => filterWords(words, { text, states: new Set(states) }).map((x) => x.kanji ?? x.kana);

  it('finds by kanji, kana, katakana as hiragana, and romaji', () => {
    expect(find('食')).toEqual(['食べる', '食べ物']);
    expect(find('たべも')).toEqual(['食べ物']);
    expect(find('こーひー')).toEqual(['コーヒー']);
    expect(find('taberu')).toEqual(['食べる']);
    // Unfinished romaji: "tab" reads as た so far.
    expect(find('tab')).toEqual(['食べる', '食べ物']);
    expect(find('ko-hi-')).toEqual(['コーヒー']);
  });

  it('finds by meaning, whole words first', () => {
    expect(find('eat')).toEqual(['食べる', '偉大']);
    expect(find('FOOD')).toEqual(['食べ物']);
    // Other senses count after the core meaning.
    expect(find('family')).toEqual(['家']);
  });

  it('puts meanings before readings that only start with the romaji', () => {
    // "home" also reads as ほめ, the start of ほめる.
    expect(find('home')).toEqual(['家', '褒める']);
    const more = [...words, w('猫', 'ねこ', 'cat'), w('傘', 'かさ', 'umbrella'), w('家庭', 'かてい', 'household', 'inbox', ['household', 'home'])];
    const in_ = (text: string) => filterWords(more, { text, states: new Set() }).map((x) => x.kanji ?? x.kana);
    // Also when "home" is only in another sense.
    expect(in_('home')).toEqual(['家', '家庭', '褒める']);
    // "cat" starts か: those readings come after every meaning, and only
    // readings that start with it count.
    expect(in_('cat')).toEqual(['猫', '傘', '家庭']);
    expect(in_('ca')).toEqual(['猫', '傘', '家庭']);
  });

  it('keeps matching while a final n could still become な or に', () => {
    const more = [w('仮名', 'かな', 'syllabary'), w('蟹', 'かに', 'crab'), w('漢字', 'かんじ', 'Chinese character'), w('本', 'ほん', 'book')];
    const in_ = (text: string) => filterWords(more, { text, states: new Set() }).map((x) => x.kanji ?? x.kana);
    expect(in_('kan')).toEqual(['漢字', '仮名', '蟹']);
    expect(in_('hon')).toEqual(['本']);
  });

  it('filters by state, and an empty query shows everything in order', () => {
    expect(find('', ['inbox'])).toEqual(['食べ物', '偉大', '褒める']);
    expect(find('', ['inbox', 'ignored'])).toEqual(['食べ物', '偉大', '褒める', '家']);
    expect(find('tabe', ['graduated'])).toEqual(['食べる']);
    expect(find('   ')).toHaveLength(words.length);
    expect(find('xyz')).toEqual([]);
  });

  it('scores exact before prefix before contains', () => {
    expect(matchScore(words[0], 'たべる')).toBe(0);
    expect(matchScore(words[0], 'たべ')).toBe(1);
    expect(matchScore(words[0], 'べる')).toBe(2);
    expect(matchScore(words[0], '飲む')).toBeNull();
  });

  it('counts each state', () => {
    expect(countStates(words)).toEqual({ unverified: 1, inbox: 3, on_page: 0, graduated: 1, ignored: 1 });
  });
});

describe('words in a list', () => {
  let db: D1Database;
  beforeEach(() => {
    db = createTestDb();
  });

  /** Imports the fixture into Manga and checks the first words: known, then unknown, then set aside. */
  async function seed(known: number, unknown: number, ignored = 0) {
    await repo.importWords(db, imported, MANGA, now);
    const { words: batch } = await repo.triageNext(db, known + unknown + ignored);
    for (const x of batch.slice(0, known)) await repo.triageAnswer(db, x.id, 'known', now);
    for (const x of batch.slice(known, known + unknown)) await repo.triageAnswer(db, x.id, 'unknown', now);
    for (const x of batch.slice(known + unknown)) await repo.triageAnswer(db, x.id, 'ignore', now);
    return batch;
  }

  async function graduatedPage() {
    const page = await repo.createPage(db, 2, MANGA, now);
    await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
    return repo.completeStage(db, page.id, 'shuffled', dayEnd, now);
  }

  const one = async (id: number) => (await repo.listWords(db, MANGA)).find((x) => x.id === id);

  it('lists every word with its state, page and reviews', async () => {
    const [known, unknown] = await seed(1, 1);
    const all = await repo.listWords(db, MANGA);
    expect(all).toHaveLength(imported.length);
    expect(all.find((x) => x.id === known.id)).toMatchObject({ status: 'graduated', hasCards: true, reviews: 0, page: null, canCheckAgain: true });
    expect(all.find((x) => x.id === unknown.id)).toMatchObject({ status: 'inbox', hasCards: false, nextDue: null, canCheckAgain: true });
    expect(all.filter((x) => x.status === 'unverified').every((x) => !x.canCheckAgain)).toBe(true);
    expect(await repo.listWords(db, SCHOOL)).toEqual([]);
    await expect(repo.listWords(db, 99)).rejects.toMatchObject({ status: 404 });

    const page = await repo.createPage(db, 1, MANGA, now);
    expect(await one(unknown.id)).toMatchObject({ status: 'on_page', page: { id: page.id, number: 1, stage: 'ordered' }, canCheckAgain: false });
  });

  it('edits kanji, kana and meaning, and refuses empty or duplicate ones', async () => {
    const [a, b] = await seed(0, 2);
    const edited = await repo.updateWord(db, a.id, { kanji: ' 試し ', kana: 'ためし', coreMeaning: ' a trial ' }, now);
    expect(edited).toMatchObject({ kanji: '試し', kana: 'ためし', coreMeaning: 'a trial' });
    // The full senses stay as imported.
    expect(edited.senses).toEqual(a.senses);
    expect((await repo.updateWord(db, a.id, { kanji: '' }, now)).kanji).toBeNull();
    await expect(repo.updateWord(db, a.id, { kana: ' ' }, now)).rejects.toMatchObject({ status: 400 });
    await expect(repo.updateWord(db, a.id, { kana: 'tameshi' }, now)).rejects.toMatchObject({ status: 400 });
    await expect(repo.updateWord(db, a.id, { kana: '試し' }, now)).rejects.toMatchObject({ status: 400 });
    expect((await repo.updateWord(db, a.id, { kana: 'コーヒー・〜' }, now)).kana).toBe('コーヒー・〜');
    await expect(repo.updateWord(db, a.id, { listId: 'school' }, now)).rejects.toMatchObject({ status: 400 });
    // Nothing to change: the word as it is.
    expect((await repo.updateWord(db, a.id, {}, now)).id).toBe(a.id);
    await expect(repo.updateWord(db, a.id, { coreMeaning: '' }, now)).rejects.toMatchObject({ status: 400 });
    await expect(repo.updateWord(db, a.id, { kana: b.kana, kanji: b.kanji }, now)).rejects.toMatchObject({ status: 409 });
    await expect(repo.updateWord(db, 999, { kana: 'あ' }, now)).rejects.toMatchObject({ status: 404 });
  });

  it('moves a word to another list, but not one on an unfinished page', async () => {
    const [a, b] = await seed(0, 2);
    expect((await repo.updateWord(db, a.id, { listId: SCHOOL }, now)).listId).toBe(SCHOOL);
    expect((await repo.listWords(db, SCHOOL)).map((x) => x.id)).toEqual([a.id]);
    await expect(repo.updateWord(db, a.id, { listId: 99 }, now)).rejects.toMatchObject({ status: 404 });

    await repo.createPage(db, 1, MANGA, now);
    expect((await repo.getWord(db, b.id)).status).toBe('on_page');
    await expect(repo.updateWord(db, b.id, { listId: SCHOOL }, now)).rejects.toMatchObject({ status: 409 });
    // Editing it is fine, and naming its own list is no move.
    expect((await repo.updateWord(db, b.id, { coreMeaning: 'x', listId: MANGA }, now)).coreMeaning).toBe('x');
    await expect(repo.setAside(db, b.id, now)).rejects.toMatchObject({ status: 409 });
    await expect(repo.deleteWord(db, b.id)).rejects.toMatchObject({ status: 409 });
  });

  it('sets a learned word aside and brings it back to review with its cards', async () => {
    const [known] = await seed(1, 0);
    const aside = await repo.setAside(db, known.id, now);
    expect(aside).toMatchObject({ status: 'ignored', hasCards: true });
    const q = await repo.reviewQueue(db, now, dayEnd, 50);
    expect(q.items.some((i) => i.word.id === known.id)).toBe(false);
    expect((await repo.bringBack(db, known.id, now)).status).toBe('graduated');
    expect((await repo.reviewQueue(db, now, dayEnd, 50)).items.some((i) => i.word.id === known.id)).toBe(true);
    await expect(repo.bringBack(db, known.id, now)).rejects.toMatchObject({ status: 409 });
    // Setting aside twice, or checking an unchecked word again, changes nothing.
    await repo.setAside(db, known.id, now);
    expect((await repo.setAside(db, known.id, now)).status).toBe('ignored');
    const [unchecked] = (await repo.triageNext(db, 1)).words;
    expect((await repo.checkAgain(db, unchecked.id, now)).status).toBe('unverified');
  });

  it('a set-aside word without cards comes back to the check pass', async () => {
    const [ignored] = await seed(0, 0, 1);
    expect(await one(ignored.id)).toMatchObject({ status: 'ignored', canCheckAgain: true });
    expect((await repo.bringBack(db, ignored.id, now)).status).toBe('unverified');
  });

  it('check again undoes a check pass answer until the word has reviews', async () => {
    const [known, other] = await seed(2, 1);
    const again = await repo.checkAgain(db, known.id, now);
    expect(again).toMatchObject({ status: 'unverified', hasCards: false, canCheckAgain: false });
    expect((await repo.triageNext(db, 100)).words.some((x) => x.id === known.id)).toBe(true);
    // It can be answered again from scratch.
    await repo.triageAnswer(db, known.id, 'known', now);
    expect((await repo.getWord(db, known.id)).status).toBe('graduated');

    expect((await repo.checkAgain(db, other.id, now)).status).toBe('unverified');

    // After a real review, Again in review is the way back.
    const q = await repo.reviewQueue(db, now, dayEnd, 50);
    const card = q.items.find((i) => i.word.id === known.id)!;
    await repo.submitReview(db, { cardId: card.cardId, rating: Rating.Good, hintUsed: false, answer: null, correct: null, durationMs: null }, now);
    expect(await one(known.id)).toMatchObject({ reviews: 1, canCheckAgain: false });
    await expect(repo.checkAgain(db, known.id, now)).rejects.toMatchObject({ status: 409 });
  });

  it('a word learned on a page is not checked again', async () => {
    await seed(0, 2);
    const page = await graduatedPage();
    await expect(repo.checkAgain(db, page.words[0].id, now)).rejects.toMatchObject({ status: 409 });
  });

  it('deletes a word with its cards, reviews and peeks; the page keeps its other words', async () => {
    await seed(0, 2);
    const page = await graduatedPage();
    const [gone, kept] = page.words;
    await repo.recordFuriganaHint(db, gone.id, '時', now);
    await repo.deleteWord(db, gone.id);
    expect((await repo.listWords(db, MANGA)).some((x) => x.id === gone.id)).toBe(false);
    expect((await repo.getPage(db, page.id)).words.map((x) => x.id)).toEqual([kept.id]);
    const backup = await repo.exportAll(db, now);
    for (const t of ['cards', 'review_log', 'kanji_hints', 'page_words'] as const) {
      expect(backup.tables[t].some((r) => r.word_id === gone.id)).toBe(false);
    }
    await expect(repo.deleteWord(db, gone.id)).rejects.toMatchObject({ status: 404 });
  });
});

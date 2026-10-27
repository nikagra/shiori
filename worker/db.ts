import type { ImportedWord } from '../shared/renshuu';
import { normalizeKana } from '../shared/kana';
import { coreMeaning } from '../shared/meaning';
import { buildQueue, type QueueCandidate } from '../shared/queue';
import { DEFAULT_WEIGHT, effectiveWeight, MAX_NAME, TYPING_CARDS_PER_DAY, MAX_PAGES_PER_WEEK, pickList, RECENT_DAYS, WEIGHT_RANGE } from '../shared/lists';
import {
  capForHint,
  DIRECTIONS,
  graduate,
  intervals,
  newCard,
  Rating,
  review,
  State,
  type Direction,
  type Grade,
  type StoredCard,
} from '../shared/scheduler';
import { graduationGrade, MAX_PAGE_WORDS, PAGE_READY, type PageStage } from '../shared/pageSession';
import { BACKUP_FORMAT, BACKUP_SCHEMA, BACKUP_TABLES, LISTS_FROM_LABELS, type Backup, type BackupRow, type BackupTable } from '../shared/backup';
import type { WordState as WordStatus } from '../shared/wordSearch';
import { DEFAULT_PREFS, HINTS_TO_LEARNING, isKanji, knownKanjiSet, markLearning, uniqueKanji, type FuriganaPrefs, type Ruby } from '../shared/furigana';
import { DEFAULT_STUDY, NEW_WORDS_RANGE, type GradeIntervals, type StudyPrefs } from '../shared/study';
import { dictInfo, entryCoreMeaning, pairs, posLabel, senseStrings, sensesFor, type DictEntry, type WordDictInfo } from '../shared/dictionary';

export type { WordState as WordStatus } from '../shared/wordSearch';

export interface WordRow {
  id: number;
  kana: string;
  kanji: string | null;
  senses: string;
  core_meaning: string;
  pos: string | null;
  source: string;
  source_list: string | null;
  source_order: number;
  renshuu_mastery: number | null;
  status: WordStatus;
  list_id: number | null;
  dict_seq: number | null;
  dict_checked: number | null;
  furigana: string | null;
  usually_kana: number;
}

export interface Word {
  id: number;
  kana: string;
  kanji: string | null;
  senses: string[];
  coreMeaning: string;
  pos: string | null;
  sourceList: string | null;
  listId: number | null;
  mastery: number | null;
  status: WordStatus;
  /** The JMdict entry it's linked to, or null. */
  dictSeq: number | null;
  /** Looked up in the dictionary: 'linked', 'none' (no entry fits), or 'unchecked' (not yet). */
  dict: 'linked' | 'none' | 'unchecked';
  /** Readings per kanji from the dictionary. */
  furigana: Ruby[] | null;
  usuallyKana: boolean;
}

export function toWord(r: WordRow): Word {
  return {
    id: r.id,
    kana: r.kana,
    kanji: r.kanji,
    senses: JSON.parse(r.senses) as string[],
    coreMeaning: r.core_meaning,
    pos: r.pos,
    sourceList: r.source_list,
    listId: r.list_id,
    mastery: r.renshuu_mastery,
    status: r.status,
    dictSeq: r.dict_seq,
    dict: r.dict_seq !== null ? 'linked' : r.dict_checked !== null ? 'none' : 'unchecked',
    furigana: r.furigana ? (JSON.parse(r.furigana) as Ruby[]) : null,
    usuallyKana: r.usually_kana === 1,
  };
}

export class AppError extends Error {
  constructor(
    public status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const iso = (d: Date) => d.toISOString();
const daysBefore = (d: Date, days: number) => new Date(d.getTime() - days * 86_400_000);

/** SQL: the word (aliased w) isn't in an archived list. */
const NOT_ARCHIVED = 'NOT EXISTS (SELECT 1 FROM lists l WHERE l.id = w.list_id AND l.archived_at IS NOT NULL)';

// ---------------------------------------------------------------- import

export interface ImportSummary {
  added: number;
  duplicates: number;
}

export async function importWords(db: D1Database, words: ImportedWord[], listId: number, now: Date): Promise<ImportSummary> {
  const list = await db.prepare('SELECT name, archived_at FROM lists WHERE id = ?').bind(listId).first<{ name: string; archived_at: string | null }>();
  if (!list) throw new AppError(404, 'list not found');
  if (list.archived_at) throw new AppError(409, 'that list is archived; unarchive it first');
  const max = await db.prepare('SELECT IFNULL(MAX(source_order), 0) AS m FROM words').first<{ m: number }>();
  const base = max?.m ?? 0;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO words
       (kana, kanji, senses, core_meaning, pos, source, source_list, list_id, source_order, renshuu_mastery, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'renshuu', ?, ?, ?, ?, 'unverified', ?, ?)`,
  );
  let added = 0;
  const chunk = 50;
  for (let i = 0; i < words.length; i += chunk) {
    const results = await db.batch(
      words.slice(i, i + chunk).map((w, j) =>
        stmt.bind(
          w.kana,
          w.kanji,
          JSON.stringify(w.senses),
          coreMeaning(w.senses),
          w.pos,
          list.name,
          listId,
          base + i + j + 1,
          w.mastery,
          iso(now),
          iso(now),
        ),
      ),
    );
    added += results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return { added, duplicates: words.length - added };
}

// ---------------------------------------------------------------- words

export async function getWord(db: D1Database, id: number): Promise<Word> {
  const row = await db.prepare('SELECT * FROM words WHERE id = ?').bind(id).first<WordRow>();
  if (!row) throw new AppError(404, 'word not found');
  return toWord(row);
}

/** A word as its list shows it: where it is and how its reviews go. */
export interface ListWord extends Word {
  page: { id: number; number: number; stage: PageStage } | null;
  /** The earlier of its two cards' due dates, or null before it has cards. */
  nextDue: string | null;
  lapses: number;
  /** Real reviews, not counting the check pass or graduation. */
  reviews: number;
  hasCards: boolean;
  /** Its check pass answer can be undone: nothing has happened to it since. */
  canCheckAgain: boolean;
}

type ListWordRow = WordRow & {
  page_id: number | null;
  page_number: number | null;
  page_stage: PageStage | null;
  next_due: string | null;
  lapses: number | null;
  cards: number;
  reviews: number | null;
  /** Log rows other than the check pass's own: reviews and graduations. */
  since_check: number | null;
};

// review_log has no index on word_id, so it's read once and grouped, not
// once per word.
const LIST_WORD_SQL = `SELECT w.*, pw.page_id, p.number AS page_number, p.stage AS page_stage,
    (SELECT MIN(due) FROM cards c WHERE c.word_id = w.id) AS next_due,
    (SELECT MAX(lapses) FROM cards c WHERE c.word_id = w.id) AS lapses,
    (SELECT COUNT(*) FROM cards c WHERE c.word_id = w.id) AS cards,
    r.reviews, r.since_check
  FROM words w LEFT JOIN page_words pw ON pw.word_id = w.id LEFT JOIN pages p ON p.id = pw.page_id
  LEFT JOIN (
    SELECT word_id, SUM(kind = 'review') AS reviews, SUM(kind != 'triage') AS since_check FROM review_log GROUP BY word_id
  ) r ON r.word_id = w.id`;

/**
 * SQL: word ? (bound twice) can have its check pass answer undone: nothing
 * happened to it since, no page and no review or graduation. canCheckAgain
 * and checkAgain both use it, so the button and the change agree.
 */
const UNTOUCHED_SINCE_CHECK = `NOT EXISTS (SELECT 1 FROM page_words WHERE word_id = ?) AND NOT EXISTS (SELECT 1 FROM review_log WHERE word_id = ? AND kind != 'triage')`;

function toListWord(r: ListWordRow): ListWord {
  const status = r.status;
  return {
    ...toWord(r),
    page: r.page_id === null ? null : { id: r.page_id, number: r.page_number!, stage: r.page_stage! },
    nextDue: r.next_due,
    lapses: r.lapses ?? 0,
    reviews: r.reviews ?? 0,
    hasCards: r.cards > 0,
    // The same test as UNTOUCHED_SINCE_CHECK.
    canCheckAgain: status !== 'unverified' && status !== 'on_page' && r.page_id === null && !r.since_check,
  };
}

/** Every word of a list, in the order they were imported. */
export async function listWords(db: D1Database, listId: number): Promise<ListWord[]> {
  await getListRow(db, listId);
  const rows = await db.prepare(`${LIST_WORD_SQL} WHERE w.list_id = ? ORDER BY w.source_order`).bind(listId).all<ListWordRow>();
  return rows.results.map(toListWord);
}

export async function getListWord(db: D1Database, id: number): Promise<ListWord> {
  const row = await db.prepare(`${LIST_WORD_SQL} WHERE w.id = ?`).bind(id).first<ListWordRow>();
  if (!row) throw new AppError(404, 'word not found');
  return toListWord(row);
}

export interface WordChanges {
  kana?: unknown;
  kanji?: unknown;
  coreMeaning?: unknown;
  listId?: unknown;
}

/** A word on a page you're drilling stays as it is, so the page keeps its words and its one list. */
function notOnPage(word: ListWord, doing: string) {
  if (word.status === 'on_page') throw new AppError(409, `this word is on page ${word.page?.number ?? '?'}, which isn't finished; ${doing} after the page`);
}

/** The guarded change found the word changed in between (the other device, say): nothing was done. */
function changedMeanwhile(result: D1Result | undefined) {
  if (!result?.meta.changes) throw new AppError(409, 'this word just changed elsewhere; reload and try again');
}

/** Kana, with ー, 〜 and ・ (as in Renshuu's readings). */
const KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー〜・ ]+$/u;

/**
 * Edits a word's kanji, kana or core meaning, or moves it to another list.
 * The full senses stay as they were imported.
 */
export async function updateWord(db: D1Database, id: number, changes: WordChanges, now: Date): Promise<ListWord> {
  const word = await getListWord(db, id);
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, value: string | number | null) => {
    sets.push(`${col} = ?`);
    values.push(value);
  };
  let kana = word.kana;
  let kanji = word.kanji;
  if (changes.kana !== undefined) {
    kana = String(changes.kana ?? '').normalize('NFKC').trim();
    if (!kana) throw new AppError(400, 'a word needs its kana');
    if (!KANA.test(kana)) throw new AppError(400, 'the reading must be in kana');
    set('kana', kana);
  }
  if (changes.kanji !== undefined) {
    kanji = String(changes.kanji ?? '').normalize('NFKC').trim() || null;
    set('kanji', kanji);
  }
  // A new spelling drops the dictionary link; it's looked up again (worker/dict.ts).
  if (kana !== word.kana || kanji !== word.kanji) {
    set('dict_seq', null);
    set('dict_checked', null);
    set('furigana', null);
    set('usually_kana', 0);
  }
  if (changes.coreMeaning !== undefined) {
    const meaning = String(changes.coreMeaning ?? '').trim();
    if (!meaning) throw new AppError(400, 'meaning must not be empty');
    set('core_meaning', meaning);
  }
  if (changes.listId !== undefined) {
    const listId = Number(changes.listId);
    if (!Number.isInteger(listId)) throw new AppError(400, 'listId must be an integer');
    if (listId !== word.listId) {
      notOnPage(word, 'move it');
      await getListRow(db, listId);
      set('list_id', listId);
    }
  }
  if (sets.length === 0) return word;
  set('updated_at', iso(now));
  // A move doesn't take a word that was just put on a page.
  const guard = sets.some((s) => s.startsWith('list_id')) ? ` AND status != 'on_page'` : '';
  try {
    changedMeanwhile(await db.prepare(`UPDATE words SET ${sets.join(', ')} WHERE id = ?${guard}`).bind(...values, id).run());
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(409, 'you already have a word with that kanji and kana');
    throw e;
  }
  return getListWord(db, id);
}

/** Sets a word aside: it leaves the check pass, pages and review, and keeps its history. */
export async function setAside(db: D1Database, id: number, now: Date): Promise<ListWord> {
  const word = await getListWord(db, id);
  if (word.status === 'ignored') return word;
  notOnPage(word, 'set it aside');
  changedMeanwhile(await db.prepare(`UPDATE words SET status = 'ignored', updated_at = ? WHERE id = ? AND status = ?`).bind(iso(now), id, word.status).run());
  return getListWord(db, id);
}

/** Brings a set-aside word back: to review if it was learned (it has cards), otherwise to the check pass. */
export async function bringBack(db: D1Database, id: number, now: Date): Promise<ListWord> {
  const word = await getListWord(db, id);
  if (word.status !== 'ignored') throw new AppError(409, 'this word is not set aside');
  changedMeanwhile(
    await db
      .prepare(`UPDATE words SET status = ?, updated_at = ? WHERE id = ? AND status = 'ignored'`)
      .bind(word.hasCards ? 'graduated' : 'unverified', iso(now), id)
      .run(),
  );
  return getListWord(db, id);
}

/**
 * Undoes a word's check pass answer, so the check pass asks again. Only while
 * nothing else has happened to it: no page and no real reviews. A word you've
 * reviewed is graded with Again instead, which FSRS is built for.
 */
export async function checkAgain(db: D1Database, id: number, now: Date): Promise<ListWord> {
  const word = await getListWord(db, id);
  if (word.status === 'unverified') return word;
  if (!word.canCheckAgain) {
    throw new AppError(409, word.page ? 'this word was learned on a page, so it is not checked again' : 'this word has reviews; grade it Again in review if you forgot it');
  }
  // One batch, guarded on the same conditions, so a review that lands in
  // between leaves the word as it was.
  const untouched = `id = ? AND status = ? AND ${UNTOUCHED_SINCE_CHECK}`;
  const guard = [id, word.status, id, id];
  const results = await db.batch([
    db.prepare(`DELETE FROM review_log WHERE word_id = ? AND kind = 'triage' AND EXISTS (SELECT 1 FROM words WHERE ${untouched})`).bind(id, ...guard),
    db.prepare(`DELETE FROM cards WHERE word_id = ? AND EXISTS (SELECT 1 FROM words WHERE ${untouched})`).bind(id, ...guard),
    db.prepare(`UPDATE words SET status = 'unverified', updated_at = ? WHERE ${untouched}`).bind(iso(now), ...guard),
  ]);
  changedMeanwhile(results.at(-1));
  return getListWord(db, id);
}

/** Deletes a word with its cards, reviews and furigana peeks. A learned page keeps its other words. */
export async function deleteWord(db: D1Database, id: number): Promise<void> {
  const word = await getListWord(db, id);
  notOnPage(word, 'delete it');
  // The status guard keeps a word that was just put on a page.
  const notOnAPage = `NOT EXISTS (SELECT 1 FROM words WHERE id = ? AND status = 'on_page')`;
  const results = await db.batch([
    db.prepare(`DELETE FROM review_log WHERE word_id = ? AND ${notOnAPage}`).bind(id, id),
    db.prepare(`DELETE FROM cards WHERE word_id = ? AND ${notOnAPage}`).bind(id, id),
    db.prepare(`DELETE FROM kanji_hints WHERE word_id = ? AND ${notOnAPage}`).bind(id, id),
    db.prepare(`DELETE FROM page_words WHERE word_id = ? AND ${notOnAPage}`).bind(id, id),
    db.prepare(`DELETE FROM words WHERE id = ? AND status != 'on_page'`).bind(id),
  ]);
  changedMeanwhile(results.at(-1));
}

// ---------------------------------------------------------------- cards

const insertCard = (db: D1Database, wordId: number, direction: Direction, card: StoredCard, now: Date) =>
  db
    .prepare('INSERT INTO cards (word_id, direction, due, state, lapses, fsrs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(wordId, direction, card.due, card.state, card.lapses, JSON.stringify(card), iso(now));

/**
 * A review_log row. `card` is the card id, or the direction of a card that is
 * inserted earlier in the same batch, so its id isn't known yet.
 */
function logReview(
  db: D1Database,
  entry: {
    card: number | Direction;
    wordId: number;
    kind: 'review' | 'triage' | 'graduation';
    rating: Grade;
    stateBefore: State;
    hintUsed?: boolean;
    answer?: string | null;
    correct?: boolean | null;
    durationMs?: number | null;
  },
  now: Date,
) {
  const byDirection = typeof entry.card === 'string';
  return db
    .prepare(
      `INSERT INTO review_log (card_id, word_id, kind, rating, state_before, hint_used, answer, correct, duration_ms, reviewed_at)
       VALUES (${byDirection ? '(SELECT id FROM cards WHERE word_id = ? AND direction = ?)' : '?'}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ...(byDirection ? [entry.wordId, entry.card] : [entry.card]),
      entry.wordId,
      entry.kind,
      entry.rating,
      entry.stateBefore,
      entry.hintUsed ? 1 : 0,
      entry.answer ?? null,
      entry.correct === undefined || entry.correct === null ? null : entry.correct ? 1 : 0,
      entry.durationMs ?? null,
      iso(now),
    );
}

/** True when a batch failed on a UNIQUE constraint, i.e. another request got there first. */
const isUniqueViolation = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

// ---------------------------------------------------------------- dictionary

/** dict_checked for a word whose entry you chose (or said none fits): it's never looked up again by itself. */
export const DICT_CHOSEN = 1_000_000;

export interface WordToLookUp {
  id: number;
  kana: string;
  kanji: string | null;
  senses: string[];
}

/**
 * Words with no dictionary entry that haven't been looked up since this much
 * of the dictionary was loaded: new words, and words with no match while it
 * was still loading.
 */
export async function wordsToLookUp(db: D1Database, loaded: number, limit: number, id?: number): Promise<{ words: WordToLookUp[]; remaining: number }> {
  const where = `dict_seq IS NULL AND (dict_checked IS NULL OR dict_checked < ?)${id === undefined ? '' : ' AND id = ?'}`;
  const params = id === undefined ? [loaded] : [loaded, id];
  const [rows, count] = await db.batch([
    db.prepare(`SELECT id, kana, kanji, senses FROM words WHERE ${where} ORDER BY id LIMIT ?`).bind(...params, limit),
    db.prepare(`SELECT COUNT(*) AS n FROM words WHERE ${where}`).bind(...params),
  ]);
  const words = (rows.results as { id: number; kana: string; kanji: string | null; senses: string }[]).map((r) => ({ ...r, senses: JSON.parse(r.senses) as string[] }));
  return { words, remaining: (count.results[0] as { n: number }).n };
}

/** Saves what the dictionary says about each word, unless its spelling changed in between. Not an edit of yours, so updated_at stays. */
export async function saveDictInfo(db: D1Database, items: { word: WordToLookUp; info: WordDictInfo; checked: number }[]): Promise<void> {
  const stmt = db.prepare(
    `UPDATE words SET dict_seq = ?, dict_checked = ?, furigana = ?, usually_kana = ?
     WHERE id = ? AND kana = ? AND IFNULL(kanji, '') = IFNULL(?, '') AND IFNULL(dict_checked, 0) < ${DICT_CHOSEN}`,
  );
  for (let i = 0; i < items.length; i += 50) {
    await db.batch(
      items
        .slice(i, i + 50)
        .map(({ word, info, checked }) =>
          stmt.bind(info.dictSeq, checked, info.furigana ? JSON.stringify(info.furigana) : null, info.usuallyKana ? 1 : 0, word.id, word.kana, word.kanji),
        ),
    );
  }
}

/** The pair in an entry that spells this word, or the entry's first one. */
function pairFor(entry: DictEntry, kanji: string | null, kana: string) {
  const all = pairs(entry, true);
  const same = (r: string) => normalizeKana(r) === normalizeKana(kana);
  return all.find(([k, r]) => same(r) && k === kanji) ?? all.find(([, r]) => same(r)) ?? all[0];
}

/** Links a word to the entry you picked, or (null) to none: "not in the dictionary". */
export async function linkEntry(db: D1Database, id: number, entry: DictEntry | null, now: Date): Promise<ListWord> {
  const word = await getListWord(db, id);
  const pair = entry && pairFor(entry, word.kanji, word.kana);
  const info = entry ? dictInfo(word, { entry, kanji: pair?.[0] ?? null, kana: pair?.[1] ?? word.kana }) : null;
  changedMeanwhile(
    await db
      .prepare(`UPDATE words SET dict_seq = ?, dict_checked = ?, furigana = ?, usually_kana = ?, updated_at = ? WHERE id = ? AND kana = ? AND IFNULL(kanji, '') = IFNULL(?, '')`)
      .bind(info?.dictSeq ?? null, DICT_CHOSEN, info?.furigana ? JSON.stringify(info.furigana) : null, info?.usuallyKana ? 1 : 0, iso(now), id, word.kana, word.kanji)
      .run(),
  );
  return getListWord(db, id);
}

export interface NewWord {
  /** The written form you chose, or null to write it in kana. */
  kanji: string | null;
  kana: string;
  coreMeaning?: unknown;
}

/**
 * Adds a word from the dictionary to a list. It waits for a page, like a word
 * you didn't know in the check pass: you looked it up because you didn't.
 */
export async function addFromDict(db: D1Database, listId: number, entry: DictEntry, chosen: NewWord, now: Date): Promise<ListWord> {
  const list = await getListRow(db, listId);
  if (list.archived_at) throw new AppError(409, 'that list is archived; unarchive it first');
  const ok = pairs(entry, true).some(([k, r]) => r === chosen.kana && (chosen.kanji === null || k === chosen.kanji));
  if (!ok) throw new AppError(400, 'that spelling is not in this dictionary entry');
  const existing = await db
    .prepare(`SELECT l.name FROM words w LEFT JOIN lists l ON l.id = w.list_id WHERE w.kana = ? AND IFNULL(w.kanji, '') = IFNULL(?, '')`)
    .bind(chosen.kana, chosen.kanji)
    .first<{ name: string | null }>();
  if (existing) throw new AppError(409, `you already have this word${existing.name ? ` in ${existing.name}` : ''}`);
  const senses = sensesFor(entry, chosen.kanji, chosen.kana);
  const core = String(chosen.coreMeaning ?? '').trim() || entryCoreMeaning(senses);
  const info = dictInfo({ kanji: chosen.kanji, kana: chosen.kana }, { entry, kanji: chosen.kanji ?? pairFor(entry, null, chosen.kana)?.[0] ?? null, kana: chosen.kana });
  const row = await db
    .prepare(
      `INSERT INTO words
         (kana, kanji, senses, core_meaning, pos, source, source_list, list_id, source_order, renshuu_mastery, status,
          dict_seq, dict_checked, furigana, usually_kana, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'dictionary', ?, ?, (SELECT IFNULL(MAX(source_order), 0) + 1 FROM words), NULL, 'inbox', ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      chosen.kana,
      chosen.kanji,
      JSON.stringify(senseStrings(senses)),
      core,
      posLabel(senses[0]?.pos ?? []) || null,
      list.name,
      listId,
      entry.seq,
      DICT_CHOSEN,
      info.furigana ? JSON.stringify(info.furigana) : null,
      info.usuallyKana ? 1 : 0,
      iso(now),
      iso(now),
    )
    .first<{ id: number }>()
    .catch((e: unknown) => {
      if (isUniqueViolation(e)) throw new AppError(409, 'you already have this word');
      throw e;
    });
  return getListWord(db, row!.id);
}

/** Your words linked to these entries, to show which search results you have already. */
export async function wordsForEntries(db: D1Database, seqs: number[]): Promise<{ id: number; dictSeq: number; kana: string; kanji: string | null; listId: number | null; listName: string | null }[]> {
  if (!seqs.length) return [];
  const rows = await db
    .prepare(
      `SELECT w.id, w.dict_seq, w.kana, w.kanji, w.list_id, l.name FROM words w LEFT JOIN lists l ON l.id = w.list_id
       WHERE w.dict_seq IN (${seqs.map(() => '?').join(', ')})`,
    )
    .bind(...seqs)
    .all<{ id: number; dict_seq: number; kana: string; kanji: string | null; list_id: number | null; name: string | null }>();
  return rows.results.map((r) => ({ id: r.id, dictSeq: r.dict_seq, kana: r.kana, kanji: r.kanji, listId: r.list_id, listName: r.name }));
}

/** Your words by dictionary state, for Settings. */
export async function dictCounts(db: D1Database): Promise<{ linked: number; none: number; unchecked: number }> {
  const row = await db
    .prepare(
      `SELECT IFNULL(SUM(dict_seq IS NOT NULL), 0) AS linked, IFNULL(SUM(dict_seq IS NULL AND dict_checked IS NOT NULL), 0) AS none,
         IFNULL(SUM(dict_seq IS NULL AND dict_checked IS NULL), 0) AS unchecked FROM words`,
    )
    .first<{ linked: number; none: number; unchecked: number }>();
  return row ?? { linked: 0, none: 0, unchecked: 0 };
}

// ---------------------------------------------------------------- triage

export type TriageResult = 'known' | 'unknown' | 'ignore';

/**
 * The next words to check, from one list or from all of them. Across lists,
 * priority decides: a focused list first, then by weight, paused lists last.
 * Within a list, lowest Renshuu mastery first.
 */
export async function triageNext(
  db: D1Database,
  limit: number,
  { listId = null, now = new Date() }: { listId?: number | null; now?: Date } = {},
): Promise<{ words: Word[]; remaining: number }> {
  const where = `w.status = 'unverified' AND ${NOT_ARCHIVED}${listId === null ? '' : ' AND w.list_id = ?'}`;
  const params = listId === null ? [] : [listId];
  const rows = await db
    .prepare(
      `SELECT w.* FROM words w LEFT JOIN lists l ON l.id = w.list_id WHERE ${where}
       ORDER BY IFNULL(l.focus_until > ?, 0) DESC, IFNULL(l.paused, 0), IFNULL(l.weight, ${DEFAULT_WEIGHT}) DESC, l.id,
         IFNULL(w.renshuu_mastery, 50), w.source_order
       LIMIT ?`,
    )
    .bind(...params, iso(now), limit)
    .all<WordRow>();
  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM words w WHERE ${where}`)
    .bind(...params)
    .first<{ n: number }>();
  return { words: rows.results.map(toWord), remaining: count?.n ?? 0 };
}

export async function triageAnswer(db: D1Database, wordId: number, result: TriageResult, now: Date): Promise<void> {
  const word = await getWord(db, wordId);
  if (word.status !== 'unverified') throw new AppError(409, 'word was already checked');
  const status: WordStatus = result === 'known' ? 'graduated' : result === 'unknown' ? 'inbox' : 'ignored';
  // One batch, so a word never ends up with cards but still unchecked. The
  // status guard makes a repeated answer change nothing.
  const stmts = [db.prepare(`UPDATE words SET status = ?, updated_at = ? WHERE id = ? AND status = 'unverified'`).bind(status, iso(now), wordId)];
  if (result === 'known') {
    // Recalled Japanese→meaning now: that card starts as reviewed.
    // Meaning→Japanese is untested, so it starts as a new card.
    const reading = review(newCard(now), Rating.Good, now);
    stmts.push(
      insertCard(db, wordId, 'jp_en', reading, now),
      insertCard(db, wordId, 'en_jp', newCard(now), now),
      logReview(db, { card: 'jp_en', wordId, kind: 'triage', rating: Rating.Good, stateBefore: State.New, correct: true }, now),
    );
  }
  try {
    await db.batch(stmts);
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(409, 'word was already checked');
    throw e;
  }
}

// ---------------------------------------------------------------- pages

export interface PageSummary {
  id: number;
  number: number;
  stage: PageStage;
  wordCount: number;
  createdAt: string;
  listId: number | null;
  listName: string | null;
}

/** Drill misses for one word of a page, by step and direction. */
export interface DrillMisses {
  step1: Record<Direction, number>;
  step2: Record<Direction, number>;
}

export interface PageDetail extends PageSummary {
  words: (Word & { position: number; misses: DrillMisses })[];
}

/** Misses a client sends for one card when it finishes a drill step. */
export interface CardMisses {
  wordId: number;
  direction: Direction;
  misses: number;
}

/** Most misses stored for one card in one step, so a stuck client can't send nonsense. */
const MAX_MISSES = 99;

/** SQL: the word can go on a page (PAGE_READY). */
const PICKABLE = `status IN (${PAGE_READY.map((s) => `'${s}'`).join(', ')})`;

/**
 * SQL for a word that goes on a page: word ? (from list ?), or NULL if it
 * just became unpickable (checked, set aside or put on another page), which
 * fails the NOT NULL on page_words.word_id and rolls the whole batch back.
 */
const PICKED_WORD = `(SELECT id FROM words WHERE id = ? AND list_id = ? AND ${PICKABLE})`;

/** A batch that put words on a page failed because one of them changed in between. */
const wordsTakenMeanwhile = (e: unknown) =>
  e instanceof Error && /(UNIQUE|NOT NULL) constraint failed/i.test(e.message) && new AppError(409, 'those words were just put on another page or changed; try again');

/**
 * Starts a page from one list: the one given, or the one furthest behind its
 * pace (pickList). A page never mixes lists, so its words stay one group.
 * With `wordIds`, the page holds those words in that order (waiting or still
 * to check, all from one list); otherwise the next waiting ones.
 */
export async function createPage(db: D1Database, size: number, listId: number | null, now: Date, wordIds?: number[]): Promise<PageDetail> {
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_WORDS) throw new AppError(400, `page size must be 1–${MAX_PAGE_WORDS}`);
  if (wordIds) {
    if (wordIds.length === 0) throw new AppError(400, 'pick at least one word');
    if (wordIds.length > size) throw new AppError(400, `a page holds at most ${size} words`);
    if (new Set(wordIds).size !== wordIds.length) throw new AppError(400, 'a word can be on a page only once');
  }
  const lists = await listInfo(db, now);
  if (wordIds) {
    const placeholders = wordIds.map(() => '?').join(', ');
    const picked = await db.prepare(`SELECT id, list_id, status FROM words WHERE id IN (${placeholders})`).bind(...wordIds).all<{ id: number; list_id: number; status: WordStatus }>();
    if (picked.results.length !== wordIds.length) throw new AppError(404, 'word not found');
    const from = new Set(picked.results.map((w) => w.list_id));
    if (from.size !== 1) throw new AppError(400, 'a page takes its words from one list');
    const [only] = from;
    if (listId !== null && listId !== only) throw new AppError(400, 'those words are in another list');
    listId = only;
    if (picked.results.some((w) => !PAGE_READY.includes(w.status))) {
      throw new AppError(409, 'only words waiting or still to check can go on a new page');
    }
  }
  if (listId === null) {
    listId = pickList(lists);
    if (listId === null) {
      throw new AppError(409, lists.some((l) => l.inbox > 0 && !l.archived) ? 'every list with words waiting is paused; pick one' : 'no words waiting for a page');
    }
  } else {
    const list = lists.find((l) => l.id === listId);
    if (!list) throw new AppError(404, 'list not found');
    if (list.archived) throw new AppError(409, 'that list is archived');
  }
  const ids =
    wordIds ??
    (
      await db
        .prepare(`SELECT id FROM words WHERE status = 'inbox' AND list_id = ? ORDER BY source_order LIMIT ?`)
        .bind(listId, size)
        .all<{ id: number }>()
    ).results.map((w) => w.id);
  if (ids.length === 0) throw new AppError(409, 'no words from that list are waiting for a page');
  // One batch: a failure leaves no empty page behind. The new page is the one
  // with the highest number, inside the batch's transaction.
  const newPage = '(SELECT id FROM pages WHERE number = (SELECT MAX(number) FROM pages))';
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO pages (number, stage, list_id, created_at) VALUES ((SELECT IFNULL(MAX(number), 0) + 1 FROM pages), 'ordered', ?, ?)`)
        .bind(listId, iso(now)),
      ...ids.flatMap((id, i) => [
        db.prepare(`INSERT INTO page_words (page_id, word_id, position) VALUES (${newPage}, ${PICKED_WORD}, ?)`).bind(id, listId, i),
        db.prepare(`UPDATE words SET status = 'on_page', updated_at = ? WHERE id = ?`).bind(iso(now), id),
      ]),
    ]);
  } catch (e) {
    throw wordsTakenMeanwhile(e) || e;
  }
  const created = await db.prepare('SELECT MAX(id) AS id FROM pages').first<{ id: number }>();
  return getPage(db, created!.id);
}

export interface PageWordChange {
  /** The word to take off the page; null adds a word at the end instead. */
  wordId: number | null;
  /** The word that takes its place: one you picked, the list's next waiting word, or none (the page gets shorter). */
  replacement: number | 'next' | null;
  /** The word taken off is set aside instead of going back to waiting. */
  setAside?: boolean;
}

/**
 * Changes one word of a new page (still in step 1): swaps it for another
 * word from the page's list, takes it off, or adds a word. The word taken off
 * goes back to waiting, or is set aside. Positions stay 0…n-1 with no gaps.
 */
export async function changePageWord(db: D1Database, pageId: number, change: PageWordChange, now: Date): Promise<PageDetail> {
  const page = await getPage(db, pageId);
  if (page.stage !== 'ordered') throw new AppError(409, 'only a page still in step 1 can change its words');
  if (page.listId === null) throw new AppError(409, 'this page has no list');
  const listId = page.listId;
  const out = change.wordId === null ? null : page.words.find((w) => w.id === change.wordId);
  if (change.wordId !== null && !out) throw new AppError(404, 'that word is not on this page');
  if (!out && change.replacement === null) throw new AppError(400, 'pick a word to add');
  if (!out && page.words.length >= MAX_PAGE_WORDS) throw new AppError(409, `a page holds at most ${MAX_PAGE_WORDS} words`);
  if (out && change.replacement === null && page.words.length === 1) throw new AppError(409, 'this is the last word on the page; delete the page instead');

  let incoming: number | null = null;
  if (change.replacement === 'next') {
    const next = await db
      .prepare(`SELECT id FROM words WHERE status = 'inbox' AND list_id = ? ORDER BY source_order LIMIT 1`)
      .bind(listId)
      .first<{ id: number }>();
    if (!next) throw new AppError(409, `no other words from ${page.listName ?? 'this list'} are waiting`);
    incoming = next.id;
  } else if (change.replacement !== null) {
    if (!Number.isInteger(change.replacement)) throw new AppError(400, 'replacement must be a word id, "next" or null');
    const word = await db.prepare('SELECT list_id, status FROM words WHERE id = ?').bind(change.replacement).first<{ list_id: number; status: WordStatus }>();
    if (!word) throw new AppError(404, 'word not found');
    if (word.list_id !== listId) throw new AppError(400, `a page takes its words from one list: pick one from ${page.listName ?? 'its list'}`);
    if (!PAGE_READY.includes(word.status)) throw new AppError(409, 'only a word waiting or still to check can go on the page');
    incoming = change.replacement;
  }

  // One batch, guarded on what was checked above: the page is still in step 1,
  // the word taken off is still on it, the word put on can still go on a page.
  // The first statement makes the change; when it finds nothing to change (the
  // other device got there first), the guarded rest does nothing either. A
  // word put on that changed meanwhile is NULL, which fails the NOT NULL on
  // page_words.word_id and rolls the whole batch back.
  const stillNew = `EXISTS (SELECT 1 FROM pages WHERE id = ? AND stage = 'ordered')`;
  const stmts: D1PreparedStatement[] = [];
  if (out && incoming !== null) {
    // The new word takes the old one's spot, wherever that is now.
    stmts.push(db.prepare(`UPDATE page_words SET word_id = ${PICKED_WORD} WHERE page_id = ? AND word_id = ? AND ${stillNew}`).bind(incoming, listId, pageId, out.id, pageId));
  } else if (out) {
    stmts.push(db.prepare(`DELETE FROM page_words WHERE page_id = ? AND word_id = ? AND position = ? AND ${stillNew}`).bind(pageId, out.id, out.position, pageId));
    // Close the gap, in two steps so no two words share a position on the way.
    // Only if this word's spot was emptied just now.
    const emptied = `NOT EXISTS (SELECT 1 FROM page_words WHERE page_id = ? AND position = ?) AND NOT EXISTS (SELECT 1 FROM page_words WHERE word_id = ?)`;
    stmts.push(
      db.prepare(`UPDATE page_words SET position = -position WHERE page_id = ? AND position > ? AND ${emptied}`).bind(pageId, out.position, pageId, out.position, out.id),
      db.prepare(`UPDATE page_words SET position = -position - 1 WHERE page_id = ? AND position < 0`).bind(pageId),
    );
  } else {
    // At the end of the page as it is now.
    const count = `(SELECT COUNT(*) FROM page_words WHERE page_id = ?)`;
    stmts.push(
      db
        .prepare(`INSERT INTO page_words (page_id, word_id, position) SELECT ?, ${PICKED_WORD}, ${count} WHERE ${stillNew} AND ${count} < ?`)
        .bind(pageId, incoming, listId, pageId, pageId, pageId, MAX_PAGE_WORDS),
    );
  }
  if (out) {
    stmts.push(
      db
        .prepare(`UPDATE words SET status = ?, updated_at = ? WHERE id = ? AND status = 'on_page' AND NOT EXISTS (SELECT 1 FROM page_words WHERE word_id = ?)`)
        .bind(change.setAside ? 'ignored' : 'inbox', iso(now), out.id, out.id),
    );
  }
  if (incoming !== null) {
    stmts.push(
      db.prepare(`UPDATE words SET status = 'on_page', updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM page_words WHERE word_id = ? AND page_id = ?)`).bind(iso(now), incoming, incoming, pageId),
    );
  }
  let results: D1Result[];
  try {
    results = await db.batch(stmts);
  } catch (e) {
    throw wordsTakenMeanwhile(e) || e;
  }
  if (!results[0]?.meta.changes) throw new AppError(409, 'this page just changed elsewhere; reload and try again');
  return getPage(db, pageId);
}

/**
 * Deletes a page. Words on an unfinished page go back to waiting. A learned
 * page's words stay in review with their history; only the page goes.
 */
export async function deletePage(db: D1Database, id: number, now: Date): Promise<void> {
  const page = await getPage(db, id);
  // Guarded on the stage seen here, so a page graduated in between (on the
  // other device) isn't emptied as if it were unfinished.
  const sameStage = `EXISTS (SELECT 1 FROM pages WHERE id = ? AND stage = ?)`;
  const stmts: D1PreparedStatement[] = [];
  if (page.stage !== 'graduated') {
    stmts.push(
      db
        .prepare(`UPDATE words SET status = 'inbox', updated_at = ? WHERE id IN (SELECT word_id FROM page_words WHERE page_id = ?) AND status = 'on_page' AND ${sameStage}`)
        .bind(iso(now), id, id, page.stage),
    );
  }
  stmts.push(
    db.prepare(`DELETE FROM page_words WHERE page_id = ? AND ${sameStage}`).bind(id, id, page.stage),
    db.prepare(`DELETE FROM pages WHERE id = ? AND stage = ?`).bind(id, page.stage),
  );
  const results = await db.batch(stmts);
  if (!results.at(-1)?.meta.changes) throw new AppError(409, 'this page just changed elsewhere; reload and try again');
}

interface PageRow {
  id: number;
  number: number;
  stage: PageStage;
  created_at: string;
  word_count: number;
  list_id: number | null;
  list_name: string | null;
}

const toSummary = (r: PageRow): PageSummary => ({
  id: r.id,
  number: r.number,
  stage: r.stage,
  wordCount: r.word_count,
  createdAt: r.created_at,
  listId: r.list_id,
  listName: r.list_name,
});

const PAGE_COLUMNS = `p.*, (SELECT COUNT(*) FROM page_words pw WHERE pw.page_id = p.id) AS word_count,
  (SELECT name FROM lists l WHERE l.id = p.list_id) AS list_name`;

export async function listPages(db: D1Database): Promise<PageSummary[]> {
  const rows = await db
    .prepare(
      `SELECT ${PAGE_COLUMNS} FROM pages p ORDER BY p.number DESC`,
    )
    .all<PageRow>();
  return rows.results.map(toSummary);
}

export async function getPage(db: D1Database, id: number): Promise<PageDetail> {
  const page = await db
    .prepare(
      `SELECT ${PAGE_COLUMNS} FROM pages p WHERE p.id = ?`,
    )
    .bind(id)
    .first<PageRow>();
  if (!page) throw new AppError(404, 'page not found');
  const words = await db
    .prepare(
      `SELECT w.*, pw.position, pw.ordered_misses_jp_en, pw.ordered_misses_en_jp, pw.shuffled_misses_jp_en, pw.shuffled_misses_en_jp
       FROM page_words pw JOIN words w ON w.id = pw.word_id
       WHERE pw.page_id = ? ORDER BY pw.position`,
    )
    .bind(id)
    .all<WordRow & { position: number; ordered_misses_jp_en: number; ordered_misses_en_jp: number; shuffled_misses_jp_en: number; shuffled_misses_en_jp: number }>();
  return {
    ...toSummary(page),
    words: words.results.map((r) => ({
      ...toWord(r),
      position: r.position,
      misses: {
        step1: { jp_en: r.ordered_misses_jp_en, en_jp: r.ordered_misses_en_jp },
        step2: { jp_en: r.shuffled_misses_jp_en, en_jp: r.shuffled_misses_en_jp },
      },
    })),
  };
}

/** Checks the misses a client sent: cards of this page, each once. */
function cleanMisses(page: PageDetail, misses: CardMisses[]): CardMisses[] {
  const ids = new Set(page.words.map((w) => w.id));
  const seen = new Set<string>();
  return misses.map((m) => {
    const key = `${m.wordId}:${m.direction}`;
    if (!ids.has(m.wordId)) throw new AppError(400, `word ${m.wordId} is not on this page`);
    if (!DIRECTIONS.includes(m.direction)) throw new AppError(400, 'direction must be jp_en or en_jp');
    if (!Number.isInteger(m.misses) || m.misses < 0) throw new AppError(400, 'misses must be a whole number');
    if (seen.has(key)) throw new AppError(400, `misses for ${key} sent twice`);
    seen.add(key);
    return { ...m, misses: Math.min(m.misses, MAX_MISSES) };
  });
}

/** The grade a card graduates with, from its step 2 misses (graduationGrade). */
const GRADUATION_RATING = { good: Rating.Good, hard: Rating.Hard, again: Rating.Again } as const;

/**
 * Marks a drill stage as finished, with the misses of that step. Finishing
 * "shuffled" graduates the page: each card starts review graded by its step 2
 * misses (right first time Good, one miss Hard, more Again).
 */
export async function completeStage(
  db: D1Database,
  id: number,
  finished: 'ordered' | 'shuffled',
  nextDayStart: Date,
  now: Date,
  misses: CardMisses[] = [],
): Promise<PageDetail> {
  const page = await getPage(db, id);
  if (page.stage !== finished) return page; // already past this stage (e.g. a retried request)
  const clean = cleanMisses(page, misses);
  // Guarded on the stage, so a retry (or the other device) can't record them twice.
  const recordMisses = clean.map((m) =>
    db
      .prepare(
        `UPDATE page_words SET ${finished}_misses_${m.direction} = ?
         WHERE page_id = ? AND word_id = ? AND (SELECT stage FROM pages WHERE id = ?) = ?`,
      )
      .bind(m.misses, id, m.wordId, id, finished),
  );
  if (finished === 'ordered') {
    await db.batch([...recordMisses, db.prepare(`UPDATE pages SET stage = 'shuffled' WHERE id = ? AND stage = 'ordered'`).bind(id)]);
    return getPage(db, id);
  }
  const missed = new Map(clean.map((m) => [`${m.wordId}:${m.direction}`, m.misses]));
  // One batch, so a page never ends up half graduated.
  try {
    await db.batch([
      ...recordMisses,
      ...page.words.flatMap((w) =>
        DIRECTIONS.flatMap((direction) => {
          const rating = GRADUATION_RATING[graduationGrade(missed.get(`${w.id}:${direction}`) ?? 0)];
          return [
            insertCard(db, w.id, direction, graduate(now, nextDayStart, rating), now),
            logReview(db, { card: direction, wordId: w.id, kind: 'graduation', rating, stateBefore: State.New, correct: rating !== Rating.Again }, now),
          ];
        }),
      ),
      db.prepare(`UPDATE pages SET stage = 'graduated', graduated_at = ? WHERE id = ?`).bind(iso(now), id),
      db
        .prepare(`UPDATE words SET status = 'graduated', updated_at = ? WHERE id IN (SELECT word_id FROM page_words WHERE page_id = ?)`)
        .bind(iso(now), id),
    ]);
  } catch (e) {
    // Another request graduated it first (a retry, or the other device).
    if (!isUniqueViolation(e)) throw e;
  }
  return getPage(db, id);
}

// ---------------------------------------------------------------- review

export interface QueueItem {
  cardId: number;
  direction: Direction;
  state: State;
  due: string;
  word: Word;
  page: { id: number; number: number; position: number } | null;
  /** When the card comes back after each grade, in days, without the jitter. */
  intervals: GradeIntervals;
}

/**
 * Today's cards in order: every due card, and new cards shared between lists
 * by weight. Also the new cards each list already had today.
 */
async function todaysQueue(db: D1Database, dayStart: Date, dayEnd: Date): Promise<{ queue: QueueCandidate[]; introduced: Map<number, number> }> {
  const candidates = await db
    .prepare(
      `SELECT c.id AS cardId, c.word_id AS wordId, c.direction, c.state, c.due, w.list_id AS listId
       FROM cards c JOIN words w ON w.id = c.word_id
       WHERE w.status = 'graduated' AND c.due < ?`,
    )
    .bind(iso(dayEnd))
    .all<QueueCandidate>();
  const reviewed = await db
    .prepare(`SELECT DISTINCT word_id FROM review_log WHERE kind = 'review' AND reviewed_at >= ?`)
    .bind(iso(dayStart))
    .all<{ word_id: number }>();
  const fresh = await db
    .prepare(
      `SELECT IFNULL(w.list_id, 0) AS listId, COUNT(*) AS n FROM review_log r JOIN words w ON w.id = r.word_id
       WHERE r.kind = 'review' AND r.state_before = ? AND r.reviewed_at >= ? GROUP BY IFNULL(w.list_id, 0)`,
    )
    .bind(State.New, iso(dayStart))
    .all<{ listId: number; n: number }>();
  // Focus counts for the whole study day it ends in.
  const lists = await db.prepare('SELECT * FROM lists').all<ListRow>();
  const introduced = new Map(fresh.results.map((r) => [r.listId, r.n]));

  const queue = buildQueue(candidates.results, {
    reviewedToday: new Set(reviewed.results.map((r) => r.word_id)),
    newIntroducedToday: introduced,
    newPerDay: TYPING_CARDS_PER_DAY,
    weights: new Map(lists.results.map((l) => [l.id, effectiveWeight(toPace(l, dayStart))])),
  });
  return { queue, introduced };
}

export async function reviewQueue(
  db: D1Database,
  dayStart: Date,
  dayEnd: Date,
  limit: number,
  now: Date = new Date(),
): Promise<{ items: QueueItem[]; total: number }> {
  const { queue } = await todaysQueue(db, dayStart, dayEnd);

  const picked = queue.slice(0, limit);
  if (picked.length === 0) return { items: [], total: queue.length };
  const wordIds = [...new Set(picked.map((c) => c.wordId))];
  const cards = await db
    .prepare(`SELECT id, fsrs FROM cards WHERE id IN (${picked.map(() => '?').join(', ')})`)
    .bind(...picked.map((c) => c.cardId))
    .all<{ id: number; fsrs: string }>();
  const fsrsById = new Map(cards.results.map((c) => [c.id, JSON.parse(c.fsrs) as StoredCard]));
  const rows = await db
    .prepare(
      `SELECT w.*, pw.page_id, pw.position, p.number AS page_number
       FROM words w
       LEFT JOIN page_words pw ON pw.word_id = w.id
       LEFT JOIN pages p ON p.id = pw.page_id
       WHERE w.id IN (${wordIds.map(() => '?').join(', ')})`,
    )
    .bind(...wordIds)
    .all<WordRow & { page_id: number | null; position: number | null; page_number: number | null }>();
  const byId = new Map(rows.results.map((r) => [r.id, r]));
  const items: QueueItem[] = picked.flatMap((c) => {
    const row = byId.get(c.wordId);
    const card = fsrsById.get(c.cardId);
    if (!row || !card) return [];
    return [
      {
        cardId: c.cardId,
        direction: c.direction,
        state: c.state,
        due: c.due,
        word: toWord(row),
        page: row.page_id === null ? null : { id: row.page_id, number: row.page_number!, position: row.position! },
        intervals: intervals(card, now),
      },
    ];
  });
  return { items, total: queue.length };
}

export interface ReviewInput {
  cardId: number;
  rating: Grade;
  hintUsed: boolean;
  answer: string | null;
  correct: boolean | null;
  durationMs: number | null;
}

export async function submitReview(db: D1Database, input: ReviewInput, now: Date): Promise<{ due: string; rating: Grade }> {
  const row = await db
    .prepare('SELECT id, word_id, fsrs FROM cards WHERE id = ?')
    .bind(input.cardId)
    .first<{ id: number; word_id: number; fsrs: string }>();
  if (!row) throw new AppError(404, 'card not found');
  const before = JSON.parse(row.fsrs) as StoredCard;
  const rating = capForHint(input.rating, input.hintUsed);
  const after = review(before, rating, now);
  await db.batch([
    db
      .prepare('UPDATE cards SET due = ?, state = ?, lapses = ?, fsrs = ? WHERE id = ?')
      .bind(after.due, after.state, after.lapses, JSON.stringify(after), row.id),
    logReview(
      db,
      {
        card: row.id,
        wordId: row.word_id,
        kind: 'review',
        rating,
        stateBefore: before.state,
        hintUsed: input.hintUsed,
        answer: input.answer,
        correct: input.correct,
        durationMs: input.durationMs,
      },
      now,
    ),
  ]);
  return { due: after.due, rating };
}

// ---------------------------------------------------------------- stats

export interface Stats {
  reviewsDue: number;
  toCheck: number;
  inbox: number;
  pagesInProgress: number;
  learned: number;
  /** Words on pages started today, against the new-words setting. */
  newWordsToday: number;
  newWordsPerDay: number;
}

export async function stats(db: D1Database, dayStart: Date, dayEnd: Date): Promise<Stats> {
  // Words in archived lists wait for nothing until the list comes back.
  const counts = await db
    .prepare(`SELECT status, COUNT(*) AS n FROM words w WHERE status NOT IN ('unverified', 'inbox') OR ${NOT_ARCHIVED} GROUP BY status`)
    .all<{ status: WordStatus; n: number }>();
  const by = Object.fromEntries(counts.results.map((r) => [r.status, r.n])) as Partial<Record<WordStatus, number>>;
  const pages = await db.prepare(`SELECT COUNT(*) AS n FROM pages WHERE stage != 'graduated'`).first<{ n: number }>();
  const queue = await reviewQueue(db, dayStart, dayEnd, 0);
  const study = await getStudy(db);
  return {
    reviewsDue: queue.total,
    toCheck: by.unverified ?? 0,
    inbox: by.inbox ?? 0,
    pagesInProgress: pages?.n ?? 0,
    learned: by.graduated ?? 0,
    newWordsToday: await newWordsToday(db, dayStart),
    newWordsPerDay: study.newWordsPerDay,
  };
}

/** Words on pages started since the study day began (pages you shape count what they hold now). */
export async function newWordsToday(db: D1Database, dayStart: Date): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM page_words pw JOIN pages p ON p.id = pw.page_id WHERE p.created_at >= ?')
    .bind(iso(dayStart))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ---------------------------------------------------------------- lists

interface ListRow {
  id: number;
  name: string;
  weight: number;
  pages_per_week: number | null;
  paused: number;
  focus_until: string | null;
  archived_at: string | null;
}

const toPace = (l: ListRow, at: Date) => ({
  weight: l.weight,
  paused: l.paused === 1,
  archived: l.archived_at !== null,
  focused: l.focus_until !== null && l.focus_until > iso(at),
});

export interface ListSummary {
  id: number;
  name: string;
  weight: number;
  pagesPerWeek: number | null;
  paused: boolean;
  /** Focused (boosted) until this time, or null. */
  focusUntil: string | null;
  focused: boolean;
  archived: boolean;
  counts: { toCheck: number; inbox: number; onPage: number; learned: number; ignored: number };
  pagesThisWeek: number;
  /** New review cards this list gets today: already met plus still to come. */
  newToday: number;
  /** "New page" without a list picks this one. */
  next: boolean;
}

/** Every list with what pickList needs. */
async function listInfo(db: D1Database, now: Date) {
  const [lists, words, pages] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT * FROM lists ORDER BY id'),
    db.prepare('SELECT list_id, status, COUNT(*) AS n FROM words GROUP BY list_id, status'),
    db
      .prepare('SELECT list_id, SUM(created_at >= ?) AS week, SUM(created_at >= ?) AS recent FROM pages GROUP BY list_id')
      .bind(iso(daysBefore(now, 7)), iso(daysBefore(now, RECENT_DAYS))),
  ]);
  const count = (id: number, status: WordStatus) =>
    (words.results as { list_id: number; status: WordStatus; n: number }[]).find((r) => r.list_id === id && r.status === status)?.n ?? 0;
  const paged = (id: number) => (pages.results as { list_id: number; week: number; recent: number }[]).find((r) => r.list_id === id);
  return (lists.results as unknown as ListRow[]).map((l) => ({
    ...toPace(l, now),
    row: l,
    id: l.id,
    inbox: count(l.id, 'inbox'),
    pagesPerWeek: l.pages_per_week,
    pagesThisWeek: paged(l.id)?.week ?? 0,
    pagesRecent: paged(l.id)?.recent ?? 0,
    counts: { toCheck: count(l.id, 'unverified'), inbox: count(l.id, 'inbox'), onPage: count(l.id, 'on_page'), learned: count(l.id, 'graduated'), ignored: count(l.id, 'ignored') },
  }));
}

export async function listLists(db: D1Database, dayStart: Date, dayEnd: Date, now: Date): Promise<ListSummary[]> {
  const info = await listInfo(db, now);
  const { queue, introduced } = await todaysQueue(db, dayStart, dayEnd);
  const next = pickList(info);
  return info.map((l) => ({
    id: l.id,
    name: l.row.name,
    weight: l.weight,
    pagesPerWeek: l.pagesPerWeek,
    paused: l.paused,
    focusUntil: l.focused ? l.row.focus_until : null,
    focused: l.focused,
    archived: l.archived,
    counts: l.counts,
    pagesThisWeek: l.pagesThisWeek,
    newToday: (introduced.get(l.id) ?? 0) + queue.filter((c) => c.listId === l.id && c.state === State.New).length,
    next: l.id === next,
  }));
}

function cleanName(name: unknown): string {
  const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new AppError(400, 'a list needs a name');
  if (trimmed.length > MAX_NAME) throw new AppError(400, `a list name can be at most ${MAX_NAME} characters`);
  return trimmed;
}

async function getListRow(db: D1Database, id: number): Promise<ListRow> {
  const row = await db.prepare('SELECT * FROM lists WHERE id = ?').bind(id).first<ListRow>();
  if (!row) throw new AppError(404, 'list not found');
  return row;
}

const nameTaken = (e: unknown) => isUniqueViolation(e) && new AppError(409, 'there is already a list with that name');

export async function createList(db: D1Database, name: unknown, now: Date): Promise<{ id: number; name: string }> {
  const clean = cleanName(name);
  try {
    const row = await db
      .prepare('INSERT INTO lists (name, weight, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING id, name')
      .bind(clean, DEFAULT_WEIGHT, iso(now), iso(now))
      .first<{ id: number; name: string }>();
    return row!;
  } catch (e) {
    throw nameTaken(e) || e;
  }
}

/** Finds a list by name, for old clients that import with a label instead of a list id. */
export async function listIdByName(db: D1Database, name: string): Promise<number> {
  const row = await db.prepare('SELECT id FROM lists WHERE name = ?').bind(name.trim()).first<{ id: number }>();
  if (!row) throw new AppError(404, `no list called ${name}`);
  return row.id;
}

export interface ListChanges {
  name?: unknown;
  weight?: unknown;
  pagesPerWeek?: unknown;
  paused?: unknown;
  focusUntil?: unknown;
  archived?: unknown;
}

/**
 * Renames, re-weights, pauses, focuses or archives a list. Focus is on one
 * list at a time, so focusing one ends any other focus; archiving ends it too.
 */
export async function updateList(db: D1Database, id: number, changes: ListChanges, now: Date): Promise<void> {
  const row = await getListRow(db, id);
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, value: string | number | null) => {
    sets.push(`${col} = ?`);
    values.push(value);
  };
  const stmts: D1PreparedStatement[] = [];
  if (changes.name !== undefined) set('name', cleanName(changes.name));
  if (changes.weight !== undefined) {
    const w = Number(changes.weight);
    if (!Number.isInteger(w) || w < WEIGHT_RANGE[0] || w > WEIGHT_RANGE[1]) throw new AppError(400, `weight must be ${WEIGHT_RANGE[0]}–${WEIGHT_RANGE[1]}`);
    set('weight', w);
  }
  if (changes.pagesPerWeek !== undefined) {
    const p = changes.pagesPerWeek === null ? null : Number(changes.pagesPerWeek);
    if (p !== null && (!Number.isInteger(p) || p < 1 || p > MAX_PAGES_PER_WEEK)) throw new AppError(400, `pagesPerWeek must be 1–${MAX_PAGES_PER_WEEK} or null`);
    set('pages_per_week', p);
  }
  if (changes.paused !== undefined) {
    if (typeof changes.paused !== 'boolean') throw new AppError(400, 'paused must be true or false');
    set('paused', changes.paused ? 1 : 0);
  }
  const archiving = changes.archived === true;
  if (changes.archived !== undefined) {
    if (typeof changes.archived !== 'boolean') throw new AppError(400, 'archived must be true or false');
    set('archived_at', changes.archived ? (row.archived_at ?? iso(now)) : null);
  }
  if (changes.focusUntil !== undefined) {
    let until: string | null = null;
    if (changes.focusUntil !== null) {
      const d = new Date(String(changes.focusUntil));
      if (Number.isNaN(d.getTime())) throw new AppError(400, 'focusUntil must be an ISO date or null');
      if (d <= now) throw new AppError(400, 'focusUntil must be in the future');
      if (archiving || (row.archived_at && changes.archived !== false)) throw new AppError(409, 'an archived list cannot be focused');
      until = iso(d);
      stmts.push(db.prepare('UPDATE lists SET focus_until = NULL, updated_at = ? WHERE id != ? AND focus_until IS NOT NULL').bind(iso(now), id));
    }
    set('focus_until', until);
  } else if (archiving) {
    set('focus_until', null);
  }
  if (sets.length === 0) return;
  set('updated_at', iso(now));
  stmts.push(db.prepare(`UPDATE lists SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id));
  try {
    await db.batch(stmts);
  } catch (e) {
    throw nameTaken(e) || e;
  }
}

/** Moves every word and page of one list into another, then removes the first. */
export async function mergeList(db: D1Database, id: number, into: number, now: Date): Promise<void> {
  if (id === into) throw new AppError(400, 'a list cannot be merged into itself');
  await getListRow(db, id);
  await getListRow(db, into);
  await db.batch([
    db.prepare('UPDATE words SET list_id = ?, updated_at = ? WHERE list_id = ?').bind(into, iso(now), id),
    db.prepare('UPDATE pages SET list_id = ? WHERE list_id = ?').bind(into, id),
    db.prepare('DELETE FROM lists WHERE id = ?').bind(id),
  ]);
}

/** Deletes a list with no words. One with words is merged or archived instead. */
export async function deleteList(db: D1Database, id: number): Promise<void> {
  await getListRow(db, id);
  const used = await db
    .prepare('SELECT (SELECT COUNT(*) FROM words WHERE list_id = ?) + (SELECT COUNT(*) FROM pages WHERE list_id = ?) AS n')
    .bind(id, id)
    .first<{ n: number }>();
  if (used!.n > 0) throw new AppError(409, 'this list has words; merge it into another list or archive it instead');
  await db.prepare('DELETE FROM lists WHERE id = ?').bind(id).run();
}

// ---------------------------------------------------------------- furigana

export interface FuriganaState {
  prefs: FuriganaPrefs;
  /** False until prefs were saved once, so a device can offer its old local ones. */
  stored: boolean;
}

const LEVELS = ['none', 'n5', 'n4'];

export async function getFurigana(db: D1Database): Promise<FuriganaState> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'furigana'").first<{ value: string }>();
  return row ? { prefs: { ...DEFAULT_PREFS, ...(JSON.parse(row.value) as Partial<FuriganaPrefs>) }, stored: true } : { prefs: DEFAULT_PREFS, stored: false };
}

function cleanPrefs(input: Partial<FuriganaPrefs>): FuriganaPrefs {
  if (!LEVELS.includes(input.kanjiLevel ?? '')) throw new AppError(400, 'kanjiLevel must be none, n5 or n4');
  return {
    kanjiLevel: input.kanjiLevel!,
    knownKanji: uniqueKanji(String(input.knownKanji ?? '')),
    learningKanji: uniqueKanji(String(input.learningKanji ?? '')),
  };
}

/**
 * Saves your furigana prefs. Kanji that become known here start with a clean
 * slate: their earlier peeks no longer count towards moving them back.
 */
export async function setFurigana(db: D1Database, input: Partial<FuriganaPrefs>, now: Date): Promise<FuriganaState> {
  const prefs = cleanPrefs(input);
  const before = knownKanjiSet((await getFurigana(db)).prefs);
  const nowKnown = [...knownKanjiSet(prefs)].filter((k) => !before.has(k));
  const stmts = [
    db
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('furigana', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .bind(JSON.stringify(prefs), iso(now)),
    ...nowKnown.map((k) => db.prepare('UPDATE kanji_hints SET cleared = 1 WHERE kanji = ? AND cleared = 0').bind(k)),
  ];
  await db.batch(stmts);
  return { prefs, stored: true };
}

/**
 * Records a furigana peek on a word. Each known kanji it revealed gets a mark
 * against it; at HINTS_TO_LEARNING marks it moves to "still learning".
 */
export async function recordFuriganaHint(
  db: D1Database,
  wordId: number,
  kanji: string,
  now: Date,
): Promise<FuriganaState & { movedToLearning: string }> {
  const revealed = uniqueKanji(kanji);
  if (!revealed || [...kanji].some((ch) => !isKanji(ch))) throw new AppError(400, 'kanji must list the kanji the hint revealed');
  if (!(await db.prepare('SELECT id FROM words WHERE id = ?').bind(wordId).first())) throw new AppError(404, 'word not found');
  await db.batch(
    [...revealed].map((k) => db.prepare('INSERT INTO kanji_hints (kanji, word_id, created_at) VALUES (?, ?, ?)').bind(k, wordId, iso(now))),
  );
  const state = await getFurigana(db);
  const known = knownKanjiSet(state.prefs);
  const placeholders = [...revealed].map(() => '?').join(', ');
  const counts = await db
    .prepare(`SELECT kanji, COUNT(*) AS n FROM kanji_hints WHERE cleared = 0 AND kanji IN (${placeholders}) GROUP BY kanji`)
    .bind(...revealed)
    .all<{ kanji: string; n: number }>();
  const moved = counts.results.filter((r) => r.n >= HINTS_TO_LEARNING && known.has(r.kanji)).map((r) => r.kanji).join('');
  if (!moved) return { ...state, movedToLearning: '' };
  const prefs = markLearning(state.prefs, moved);
  await db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('furigana', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(JSON.stringify(prefs), iso(now))
    .run();
  return { prefs, stored: true, movedToLearning: moved };
}

// ---------------------------------------------------------------- study settings

export async function getStudy(db: D1Database): Promise<StudyPrefs> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'study'").first<{ value: string }>();
  return row ? { ...DEFAULT_STUDY, ...(JSON.parse(row.value) as Partial<StudyPrefs>) } : DEFAULT_STUDY;
}

/** Changes the study settings you send; the others stay as they were. */
export async function setStudy(db: D1Database, input: Partial<StudyPrefs> | null, now: Date): Promise<StudyPrefs> {
  if (input === null || typeof input !== 'object' || (input.newWordsPerDay === undefined && input.showIntervals === undefined)) {
    throw new AppError(400, 'send newWordsPerDay or showIntervals');
  }
  const prefs = { ...(await getStudy(db)) };
  if (input.newWordsPerDay !== undefined) {
    const n = input.newWordsPerDay;
    const [min, max] = NEW_WORDS_RANGE;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new AppError(400, `newWordsPerDay must be a whole number ${min}–${max}`);
    prefs.newWordsPerDay = n;
  }
  if (input.showIntervals !== undefined) {
    if (typeof input.showIntervals !== 'boolean') throw new AppError(400, 'showIntervals must be true or false');
    prefs.showIntervals = input.showIntervals;
  }
  await db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('study', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(JSON.stringify(prefs), iso(now))
    .run();
  return prefs;
}

// ---------------------------------------------------------------- backup

/** Every row of every table, read in one batch so the copy is consistent. */
export async function exportAll(db: D1Database, now: Date): Promise<Backup> {
  const results = await db.batch<BackupRow>(BACKUP_TABLES.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`)));
  const tables = Object.fromEntries(BACKUP_TABLES.map((t, i) => [t, results[i].results])) as Record<BackupTable, BackupRow[]>;
  return { app: 'shiori', format: BACKUP_FORMAT, schema: BACKUP_SCHEMA, exportedAt: iso(now), tables };
}

// ---------------------------------------------------------------- test support

export async function resetAll(db: D1Database): Promise<void> {
  // Children before parents, for the foreign keys. Then the starting lists
  // again, as after the migrations.
  await db.batch([...BACKUP_TABLES].reverse().map((t) => db.prepare(`DELETE FROM ${t}`)));
  const seed = LISTS_FROM_LABELS.split(/;\s*$/m).filter((sql) => sql.trim());
  await db.batch(seed.map((sql) => db.prepare(sql)));
}

/** Makes cards due now (all, or one direction), to exercise reviews in end-to-end tests. */
export async function makeAllDue(db: D1Database, now: Date, direction?: Direction): Promise<void> {
  const rows = direction
    ? await db.prepare('SELECT id, fsrs FROM cards WHERE direction = ?').bind(direction).all<{ id: number; fsrs: string }>()
    : await db.prepare('SELECT id, fsrs FROM cards').all<{ id: number; fsrs: string }>();
  for (const r of rows.results) {
    const card = { ...(JSON.parse(r.fsrs) as StoredCard), due: iso(now) };
    await db.prepare('UPDATE cards SET due = ?, fsrs = ? WHERE id = ?').bind(card.due, JSON.stringify(card), r.id).run();
  }
}

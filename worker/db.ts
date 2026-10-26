import type { ImportedWord } from '../shared/renshuu';
import { coreMeaning } from '../shared/meaning';
import { buildQueue, type QueueCandidate } from '../shared/queue';
import { DEFAULT_WEIGHT, effectiveWeight, MAX_NAME, NEW_PER_DAY, MAX_PAGES_PER_WEEK, pickList, RECENT_DAYS, WEIGHT_RANGE } from '../shared/lists';
import {
  capForHint,
  DIRECTIONS,
  graduate,
  newCard,
  Rating,
  review,
  State,
  type Direction,
  type Grade,
  type StoredCard,
} from '../shared/scheduler';
import type { PageStage } from '../shared/pageSession';
import { BACKUP_FORMAT, BACKUP_SCHEMA, BACKUP_TABLES, LISTS_FROM_LABELS, type Backup, type BackupRow, type BackupTable } from '../shared/backup';
import { DEFAULT_PREFS, HINTS_TO_LEARNING, isKanji, knownKanjiSet, markLearning, uniqueKanji, type FuriganaPrefs } from '../shared/furigana';

export type WordStatus = 'unverified' | 'inbox' | 'on_page' | 'graduated' | 'ignored';

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

export async function updateCoreMeaning(db: D1Database, id: number, meaning: string, now: Date): Promise<Word> {
  const trimmed = meaning.trim();
  if (!trimmed) throw new AppError(400, 'meaning must not be empty');
  await db.prepare('UPDATE words SET core_meaning = ?, updated_at = ? WHERE id = ?').bind(trimmed, iso(now), id).run();
  return getWord(db, id);
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

// ---------------------------------------------------------------- triage

export type TriageResult = 'known' | 'unknown' | 'ignore';

export async function triageNext(db: D1Database, limit: number): Promise<{ words: Word[]; remaining: number }> {
  const rows = await db
    .prepare(
      `SELECT * FROM words w WHERE status = 'unverified' AND ${NOT_ARCHIVED}
       ORDER BY IFNULL(renshuu_mastery, 50), source_order LIMIT ?`,
    )
    .bind(limit)
    .all<WordRow>();
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM words w WHERE status = 'unverified' AND ${NOT_ARCHIVED}`).first<{ n: number }>();
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

export interface PageDetail extends PageSummary {
  words: (Word & { position: number })[];
}

/**
 * Starts a page from one list: the one given, or the one furthest behind its
 * pace (pickList). A page never mixes lists, so its words stay one group.
 */
export async function createPage(db: D1Database, size: number, listId: number | null, now: Date): Promise<PageDetail> {
  if (!Number.isInteger(size) || size < 1 || size > 20) throw new AppError(400, 'page size must be 1–20');
  const lists = await listInfo(db, now);
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
  const inbox = await db
    .prepare(`SELECT id FROM words WHERE status = 'inbox' AND list_id = ? ORDER BY source_order LIMIT ?`)
    .bind(listId, size)
    .all<{ id: number }>();
  if (inbox.results.length === 0) throw new AppError(409, 'no words from that list are waiting for a page');
  // One batch: a failure leaves no empty page behind. The new page is the one
  // with the highest number, inside the batch's transaction.
  const newPage = '(SELECT id FROM pages WHERE number = (SELECT MAX(number) FROM pages))';
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO pages (number, stage, list_id, created_at) VALUES ((SELECT IFNULL(MAX(number), 0) + 1 FROM pages), 'ordered', ?, ?)`)
        .bind(listId, iso(now)),
      ...inbox.results.flatMap((w, i) => [
        db.prepare(`INSERT INTO page_words (page_id, word_id, position) VALUES (${newPage}, ?, ?)`).bind(w.id, i),
        db.prepare(`UPDATE words SET status = 'on_page', updated_at = ? WHERE id = ?`).bind(iso(now), w.id),
      ]),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(409, 'those words were just put on another page; try again');
    throw e;
  }
  const created = await db.prepare('SELECT MAX(id) AS id FROM pages').first<{ id: number }>();
  return getPage(db, created!.id);
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
      `SELECT w.*, pw.position FROM page_words pw JOIN words w ON w.id = pw.word_id
       WHERE pw.page_id = ? ORDER BY pw.position`,
    )
    .bind(id)
    .all<WordRow & { position: number }>();
  return { ...toSummary(page), words: words.results.map((r) => ({ ...toWord(r), position: r.position })) };
}

/** Marks a drill stage as finished. Finishing "shuffled" graduates the page. */
export async function completeStage(
  db: D1Database,
  id: number,
  finished: 'ordered' | 'shuffled',
  nextDayStart: Date,
  now: Date,
): Promise<PageDetail> {
  const page = await getPage(db, id);
  if (page.stage !== finished) return page; // already past this stage (e.g. a retried request)
  if (finished === 'ordered') {
    await db.prepare(`UPDATE pages SET stage = 'shuffled' WHERE id = ?`).bind(id).run();
    return getPage(db, id);
  }
  // One batch, so a page never ends up half graduated.
  try {
    await db.batch([
      ...page.words.flatMap((w) =>
        DIRECTIONS.flatMap((direction) => [
          insertCard(db, w.id, direction, graduate(now, nextDayStart), now),
          logReview(db, { card: direction, wordId: w.id, kind: 'graduation', rating: Rating.Good, stateBefore: State.New, correct: true }, now),
        ]),
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
    newPerDay: NEW_PER_DAY,
    weights: new Map(lists.results.map((l) => [l.id, effectiveWeight(toPace(l, dayStart))])),
  });
  return { queue, introduced };
}

export async function reviewQueue(db: D1Database, dayStart: Date, dayEnd: Date, limit: number): Promise<{ items: QueueItem[]; total: number }> {
  const { queue } = await todaysQueue(db, dayStart, dayEnd);

  const picked = queue.slice(0, limit);
  if (picked.length === 0) return { items: [], total: queue.length };
  const wordIds = [...new Set(picked.map((c) => c.wordId))];
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
    if (!row) return [];
    return [
      {
        cardId: c.cardId,
        direction: c.direction,
        state: c.state,
        due: c.due,
        word: toWord(row),
        page: row.page_id === null ? null : { id: row.page_id, number: row.page_number!, position: row.position! },
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
}

export async function stats(db: D1Database, dayStart: Date, dayEnd: Date): Promise<Stats> {
  // Words in archived lists wait for nothing until the list comes back.
  const counts = await db
    .prepare(`SELECT status, COUNT(*) AS n FROM words w WHERE status NOT IN ('unverified', 'inbox') OR ${NOT_ARCHIVED} GROUP BY status`)
    .all<{ status: WordStatus; n: number }>();
  const by = Object.fromEntries(counts.results.map((r) => [r.status, r.n])) as Partial<Record<WordStatus, number>>;
  const pages = await db.prepare(`SELECT COUNT(*) AS n FROM pages WHERE stage != 'graduated'`).first<{ n: number }>();
  const queue = await reviewQueue(db, dayStart, dayEnd, 0);
  return {
    reviewsDue: queue.total,
    toCheck: by.unverified ?? 0,
    inbox: by.inbox ?? 0,
    pagesInProgress: pages?.n ?? 0,
    learned: by.graduated ?? 0,
  };
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

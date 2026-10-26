import type { ImportedWord } from '../shared/renshuu';
import { coreMeaning } from '../shared/meaning';
import { buildQueue, NEW_PER_DAY, type QueueCandidate } from '../shared/queue';
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
import { BACKUP_FORMAT, BACKUP_SCHEMA, BACKUP_TABLES, type Backup, type BackupRow, type BackupTable } from '../shared/backup';
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
}

export interface Word {
  id: number;
  kana: string;
  kanji: string | null;
  senses: string[];
  coreMeaning: string;
  pos: string | null;
  sourceList: string | null;
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

// ---------------------------------------------------------------- import

export interface ImportSummary {
  added: number;
  duplicates: number;
}

export async function importWords(db: D1Database, words: ImportedWord[], list: string | null, now: Date): Promise<ImportSummary> {
  const max = await db.prepare('SELECT IFNULL(MAX(source_order), 0) AS m FROM words').first<{ m: number }>();
  const base = max?.m ?? 0;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO words
       (kana, kanji, senses, core_meaning, pos, source, source_list, source_order, renshuu_mastery, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'renshuu', ?, ?, ?, 'unverified', ?, ?)`,
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
          list,
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
      `SELECT * FROM words WHERE status = 'unverified'
       ORDER BY IFNULL(renshuu_mastery, 50), source_order LIMIT ?`,
    )
    .bind(limit)
    .all<WordRow>();
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM words WHERE status = 'unverified'`).first<{ n: number }>();
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
}

export interface PageDetail extends PageSummary {
  words: (Word & { position: number })[];
}

export async function createPage(db: D1Database, size: number, now: Date): Promise<PageDetail> {
  if (!Number.isInteger(size) || size < 1 || size > 20) throw new AppError(400, 'page size must be 1–20');
  const inbox = await db
    .prepare(`SELECT id FROM words WHERE status = 'inbox' ORDER BY source_order LIMIT ?`)
    .bind(size)
    .all<{ id: number }>();
  if (inbox.results.length === 0) throw new AppError(409, 'no words waiting for a page');
  // One batch: a failure leaves no empty page behind. The new page is the one
  // with the highest number, inside the batch's transaction.
  const newPage = '(SELECT id FROM pages WHERE number = (SELECT MAX(number) FROM pages))';
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO pages (number, stage, created_at) VALUES ((SELECT IFNULL(MAX(number), 0) + 1 FROM pages), 'ordered', ?)`)
        .bind(iso(now)),
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
}

const toSummary = (r: PageRow): PageSummary => ({
  id: r.id,
  number: r.number,
  stage: r.stage,
  wordCount: r.word_count,
  createdAt: r.created_at,
});

export async function listPages(db: D1Database): Promise<PageSummary[]> {
  const rows = await db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM page_words pw WHERE pw.page_id = p.id) AS word_count
       FROM pages p ORDER BY p.number DESC`,
    )
    .all<PageRow>();
  return rows.results.map(toSummary);
}

export async function getPage(db: D1Database, id: number): Promise<PageDetail> {
  const page = await db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM page_words pw WHERE pw.page_id = p.id) AS word_count
       FROM pages p WHERE p.id = ?`,
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

export async function reviewQueue(db: D1Database, dayStart: Date, dayEnd: Date, limit: number): Promise<{ items: QueueItem[]; total: number }> {
  const candidates = await db
    .prepare(
      `SELECT c.id AS cardId, c.word_id AS wordId, c.direction, c.state, c.due
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
    .prepare(`SELECT COUNT(*) AS n FROM review_log WHERE kind = 'review' AND state_before = ? AND reviewed_at >= ?`)
    .bind(State.New, iso(dayStart))
    .first<{ n: number }>();

  const queue = buildQueue(candidates.results, {
    reviewedToday: new Set(reviewed.results.map((r) => r.word_id)),
    newIntroducedToday: fresh?.n ?? 0,
    newPerDay: NEW_PER_DAY,
  });

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
  const counts = await db
    .prepare('SELECT status, COUNT(*) AS n FROM words GROUP BY status')
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
  // Children before parents, for the foreign keys.
  await db.batch([...BACKUP_TABLES].reverse().map((t) => db.prepare(`DELETE FROM ${t}`)));
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

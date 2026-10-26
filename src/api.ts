// Typed client for the Shiori API.

import { parseBackup, type Backup, type NightlyStatus } from '../shared/backup';
import type { FuriganaPrefs } from '../shared/furigana';

export type Direction = 'jp_en' | 'en_jp';
export type WordStatus = 'unverified' | 'inbox' | 'on_page' | 'graduated' | 'ignored';
export type PageStage = 'ordered' | 'shuffled' | 'graduated';

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

/** A word as its list shows it (worker/db.ts ListWord). */
export interface ListWord extends Word {
  page: { id: number; number: number; stage: PageStage } | null;
  nextDue: string | null;
  lapses: number;
  reviews: number;
  hasCards: boolean;
  canCheckAgain: boolean;
}

export interface WordChanges {
  kana?: string;
  kanji?: string | null;
  coreMeaning?: string;
  listId?: number;
}

export interface Stats {
  reviewsDue: number;
  toCheck: number;
  inbox: number;
  pagesInProgress: number;
  learned: number;
}

export interface PageSummary {
  id: number;
  number: number;
  stage: PageStage;
  wordCount: number;
  createdAt: string;
  listId: number | null;
  listName: string | null;
}

export interface ListSummary {
  id: number;
  name: string;
  weight: number;
  pagesPerWeek: number | null;
  paused: boolean;
  focusUntil: string | null;
  focused: boolean;
  archived: boolean;
  counts: { toCheck: number; inbox: number; onPage: number; learned: number; ignored: number };
  pagesThisWeek: number;
  newToday: number;
  /** "New page" without a list picks this one. */
  next: boolean;
}

export interface ListChanges {
  name?: string;
  weight?: number;
  pagesPerWeek?: number | null;
  paused?: boolean;
  focusUntil?: string | null;
  archived?: boolean;
}

export interface PageDetail extends PageSummary {
  words: (Word & { position: number })[];
}

export interface QueueItem {
  cardId: number;
  direction: Direction;
  state: number;
  due: string;
  word: Word;
  page: { id: number; number: number; position: number } | null;
}

export interface ImportResult {
  format: 'basic' | 'custom';
  added: number;
  duplicates: number;
  issues: { line: number; text: string; reason: string }[];
}

export class ApiError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** The study day starts at 04:00 local time, like Anki, so late-night sessions count for "today". */
export function studyDay(now = new Date()) {
  const start = new Date(now);
  start.setHours(4, 0, 0, 0);
  if (now < start) start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

const dayQuery = () => {
  const { start, end } = studyDay();
  return `dayStart=${encodeURIComponent(start.toISOString())}&dayEnd=${encodeURIComponent(end.toISOString())}`;
};

export const api = {
  stats: () => call<Stats>('GET', `/stats?${dayQuery()}`),
  importText: (text: string, listId: number) => call<ImportResult>('POST', '/import', { text, listId }),
  /** listId null: all lists, in priority order. */
  triage: (listId: number | null) => call<{ words: Word[]; remaining: number }>('GET', listId === null ? '/triage' : `/triage?list=${listId}`),
  triageAnswer: (id: number, result: 'known' | 'unknown' | 'ignore') => call<{ ok: true }>('POST', `/triage/${id}`, { result }),
  updateMeaning: (id: number, coreMeaning: string) => call<Word>('PATCH', `/words/${id}`, { coreMeaning }),
  listWords: (listId: number) => call<ListWord[]>('GET', `/lists/${listId}/words`),
  updateWord: (id: number, changes: WordChanges) => call<ListWord>('PATCH', `/words/${id}`, changes),
  setAside: (id: number) => call<ListWord>('POST', `/words/${id}/set-aside`),
  bringBack: (id: number) => call<ListWord>('POST', `/words/${id}/bring-back`),
  checkAgain: (id: number) => call<ListWord>('POST', `/words/${id}/check-again`),
  deleteWord: (id: number) => call<{ ok: true }>('DELETE', `/words/${id}`),
  pages: () => call<PageSummary[]>('GET', '/pages'),
  page: (id: number) => call<PageDetail>('GET', `/pages/${id}`),
  /** listId null lets the server pick the list furthest behind its pace. */
  createPage: (size: number, listId: number | null) => call<PageDetail>('POST', '/pages', { size, listId }),
  lists: () => call<ListSummary[]>('GET', `/lists?${dayQuery()}`),
  createList: (name: string) => call<{ id: number; name: string }>('POST', '/lists', { name }),
  updateList: (id: number, changes: ListChanges) => call<{ ok: true }>('PATCH', `/lists/${id}`, changes),
  mergeList: (id: number, into: number) => call<{ ok: true }>('POST', `/lists/${id}/merge`, { into }),
  deleteList: (id: number) => call<{ ok: true }>('DELETE', `/lists/${id}`),
  completeStage: (id: number, stage: 'ordered' | 'shuffled') =>
    call<PageDetail>('POST', `/pages/${id}/complete`, { stage, nextDayStart: studyDay().end.toISOString() }),
  reviewQueue: () => call<{ items: QueueItem[]; total: number }>('GET', `/review?${dayQuery()}`),
  furigana: () => call<{ prefs: FuriganaPrefs; stored: boolean }>('GET', '/furigana'),
  setFurigana: (prefs: FuriganaPrefs) => call<{ prefs: FuriganaPrefs; stored: boolean }>('PUT', '/furigana', prefs),
  furiganaHint: (wordId: number, kanji: string) =>
    call<{ prefs: FuriganaPrefs; movedToLearning: string }>('POST', '/furigana/hint', { wordId, kanji }),
  nightlyBackups: () => call<NightlyStatus>('GET', '/backup/nightly'),
  /** Fetched and checked here, so an error page is never saved as a backup. */
  backup: async (): Promise<{ backup: Backup; text: string }> => {
    let res: Response;
    try {
      res = await fetch('/api/backup', { cache: 'no-store' });
    } catch {
      throw new ApiError('the server could not be reached. If the app has been open a long time, reload it to sign in again.');
    }
    const text = await res.text();
    if (!res.ok) throw new ApiError(`the server answered ${res.status}`);
    return { backup: parseBackup(text), text };
  },
  submitReview: (cardId: number, body: { rating: number; hintUsed: boolean; answer?: string; correct?: boolean; durationMs: number }) =>
    call<{ due: string; rating: number }>('POST', `/review/${cardId}`, body),
};

export const writtenForm = (w: Pick<Word, 'kanji' | 'kana'>) => w.kanji ?? w.kana;

/** "Godan verb - る (ます = stem+ります)/intransitive" → "Godan verb - る · intransitive" */
export const shortPos = (pos: string) => pos.replace(/\s*\(ます = [^)]*\)/g, '').replace(/\//g, ' · ');

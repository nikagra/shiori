import { normalizeKana } from './kana';

// Finding words in a list: one search box for kana, romaji, kanji or meaning,
// and filters by state. Pure, so the list screen and the page builder (v0.2
// step 3) share it, and it's unit tested.

export type WordState = 'unverified' | 'inbox' | 'on_page' | 'graduated' | 'ignored';

/** The filters, in the order a word moves through them. */
export const WORD_STATES: { state: WordState; label: string }[] = [
  { state: 'unverified', label: 'To check' },
  { state: 'inbox', label: 'Waiting' },
  { state: 'on_page', label: 'On a page' },
  { state: 'graduated', label: 'Learning' },
  { state: 'ignored', label: 'Set aside' },
];

export interface Searchable {
  kana: string;
  kanji: string | null;
  coreMeaning: string;
  senses: string[];
  status: WordState;
}

export interface WordQuery {
  text: string;
  /** Empty: every state. */
  states: ReadonlySet<WordState>;
}

interface Needle {
  raw: string;
  /** The query as hiragana, when it can be read as kana (romaji included). */
  kana: string | null;
  /** The query in lower case, when it has Latin letters (a meaning). */
  latin: string | null;
}

const LATIN = /[a-z]/;

function needle(text: string): Needle | null {
  const raw = text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return null;
  const hasLatin = LATIN.test(raw);
  // Romaji typed so far: "tab" reads as "たb", so the unfinished letters go.
  const kana = normalizeKana(raw).replace(/[a-z'-]+$/, '');
  const readable = kana !== '' && !LATIN.test(kana);
  return { raw, kana: readable ? kana : null, latin: hasLatin ? raw : null };
}

/** 0 exact, 1 starts with it, 2 contains it; null when it isn't there. */
function place(hay: string, n: string): number | null {
  if (hay === n) return 0;
  if (hay.startsWith(n)) return 1;
  return hay.includes(n) ? 2 : null;
}

/** A meaning matches better on a whole word ("eat" in "to eat") than inside one ("eat" in "great"). */
function placeInMeaning(meaning: string, n: string): number | null {
  const m = meaning.toLowerCase();
  const at = place(m, n);
  if (at === null) return null;
  if (at === 0 || m.replace(/^to /, '') === n) return 0;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(m)) return 1;
  return new RegExp(`(^|[^a-z])${escaped}`).test(m) ? 2 : 3;
}

/**
 * How well a word matches: lower is better, null for no match. The written
 * form and the reading come first, then the core meaning, then other senses.
 */
export function matchScore(word: Searchable, text: string): number | null {
  const n = needle(text);
  if (!n) return 0;
  const scores: number[] = [];
  const add = (s: number | null, offset: number) => s !== null && scores.push(s + offset);
  if (word.kanji) add(place(word.kanji, n.raw), 0);
  if (n.kana) {
    // Romaji can be English too ("home" reads ほめ): unless the reading is
    // exactly it, meanings with it as a whole word come first.
    const at = place(normalizeKana(word.kana), n.kana);
    add(at, at === 0 || !n.latin ? 0 : 10.5);
  }
  if (n.latin) {
    add(placeInMeaning(word.coreMeaning, n.latin), 10);
    for (const s of word.senses) add(placeInMeaning(s, n.latin), 20);
  }
  return scores.length ? Math.min(...scores) : null;
}

/** The words that match, best match first; ties keep their order. */
export function filterWords<T extends Searchable>(words: readonly T[], query: WordQuery): T[] {
  const scored: { word: T; score: number; i: number }[] = [];
  words.forEach((word, i) => {
    if (query.states.size > 0 && !query.states.has(word.status)) return;
    const score = matchScore(word, query.text);
    if (score !== null) scored.push({ word, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((s) => s.word);
}

/** How many words are in each state, for the filter buttons. */
export function countStates(words: readonly Pick<Searchable, 'status'>[]): Record<WordState, number> {
  const counts = Object.fromEntries(WORD_STATES.map((s) => [s.state, 0])) as Record<WordState, number>;
  for (const w of words) counts[w.status]++;
  return counts;
}

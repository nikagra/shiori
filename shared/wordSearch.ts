import { normalizeKana } from './kana';

// Finding words in a list: one search box for kana, romaji, kanji or meaning,
// and filters by state. Pure, so the list screen and the page builder (v0.2
// step 3) share it, and it's unit tested.

export type WordState = 'unverified' | 'inbox' | 'on_page' | 'graduated' | 'ignored';

// A Record, so a new state can't be left without a filter.
const LABELS: Record<WordState, string> = {
  unverified: 'To check',
  inbox: 'Waiting',
  on_page: 'On a page',
  graduated: 'Learned',
  ignored: 'Set aside',
};

/** The filters, in the order a word moves through them. */
export const WORD_STATES = (Object.keys(LABELS) as WordState[]).map((state) => ({ state, label: LABELS[state] }));

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
  /** The query in lower case, when it has Latin letters (a meaning, or romaji). */
  latin: string | null;
  /** The query read as hiragana. `partial` when romaji was cut short ("tab" reads た so far). */
  readings: { kana: string; partial: boolean }[];
}

const LATIN = /[a-z]/;

function needle(text: string): Needle | null {
  const raw = text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return null;
  if (!LATIN.test(raw)) return { raw, latin: null, readings: [{ kana: normalizeKana(raw), partial: false }] };
  const readings: Needle['readings'] = [];
  const read = (romaji: string) => {
    const kana = normalizeKana(romaji);
    if (!LATIN.test(kana)) return { kana, partial: false };
    // Romaji typed so far: the unfinished letters go.
    const cut = kana.replace(/[a-z'-]+$/, '');
    return cut && !LATIN.test(cut) ? { kana: cut, partial: true } : null;
  };
  const full = read(raw);
  if (full) readings.push(full);
  // A final n is ん, or the start of な, に, ...: "kan" on the way to "kana".
  if (/[^n]n$/.test(raw)) {
    const before = read(raw.slice(0, -1));
    if (before) readings.push({ kana: before.kana, partial: true });
  }
  return { raw, latin: raw, readings };
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
 * How well a word matches: lower is better, null for no match. Kana or kanji
 * typed in Japanese match the written form and the reading first. A query in
 * Latin letters is first a meaning (core meaning, then other senses) and only
 * then romaji, since English often reads as kana too ("home" is ほめ, "cat"
 * starts か); only a reading that is exactly the romaji comes first.
 */
export function matchScore(word: Searchable, text: string): number | null {
  const n = needle(text);
  if (!n) return 0;
  const scores: number[] = [];
  const add = (s: number | null, offset: number) => s !== null && scores.push(s + offset);
  if (word.kanji) add(place(word.kanji, n.raw), 0);
  const reading = normalizeKana(word.kana);
  for (const r of n.readings) {
    const at = place(reading, r.kana);
    if (at === null) continue;
    if (!n.latin) add(at, 0);
    else if (r.partial) add(at === 2 ? null : 25, 0);
    else add(at === 0 ? 0 : at === 1 ? 21.5 : 24, 0);
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

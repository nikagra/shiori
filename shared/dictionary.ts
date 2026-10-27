import { toHiragana, toKatakana } from 'wanakana';
import { normalizeKana } from './kana';
import { splitGlosses, stripTags } from './meaning';
import { N4_KANJI, N5_KANJI } from './furigana';
import { headPair, pairs, rubyFor, senseStrings, usuallyKana, type DictEntry, type Ruby } from './dictEntry';

// The dictionary lives in its own D1 database (DICT), so backups stay small
// and it can be rebuilt any time (scripts/dict-build.ts, scripts/dict-load.ts).
// Searching it and matching your words to its entries are pure, so the
// Worker and the tests share them.

export * from './dictEntry';

// ---------------------------------------------------------------- searching

/** An FTS5 string: quoted, with quotes doubled. */
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

const LATIN = /[a-z]/i;
const HAN = /\p{Script=Han}/u;
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々]/u;

/** Shortest English word searched as a prefix: "ca" would match most of the dictionary. */
const MIN_PREFIX = 3;

/**
 * What to ask the search index, as separate searches merged in order. Kana
 * match hiragana and katakana alike; romaji is read as kana as well as
 * English. Everything matches the start of a written form or word.
 */
export function searchSteps(query: string): string[] {
  const q = query.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return [];
  const steps: string[] = [];
  const kanaForms = (s: string) => [...new Set([s, toHiragana(s, { passRomaji: true }), toKatakana(s, { passRomaji: true })])];
  // Any kana or kanji: a written form, even with letters in it (Tシャツ).
  if (JAPANESE.test(q)) {
    const forms = kanaForms(q.replace(/[\s〜～]/g, ''));
    steps.push(`forms : (${forms.map((f) => `${quote(f)}*`).join(' OR ')})`);
    return steps;
  }
  if (!LATIN.test(q)) return steps;
  // English: first the words as a phrase (also as a verb, "to go"), since a
  // common word like "go" is in thousands of meanings and only the first
  // results are ranked; then every word, the last one maybe unfinished.
  const words = q.split(/[^a-z0-9']+/).filter(Boolean);
  if (words.length) {
    const phrase = words.join(' ');
    steps.push(`glosses : (${[phrase, ...(words[0] === 'to' ? [] : [`to ${phrase}`])].map(quote).join(' OR ')})`);
    const last = words.length - 1;
    steps.push(`glosses : (${words.map((w, i) => (i === last && w.length >= MIN_PREFIX ? `${quote(w)}*` : quote(w))).join(' ')})`);
  }
  // Romaji: one word that all turns into kana. Several words are English.
  const kana = normalizeKana(q);
  if (!q.includes(' ') && !LATIN.test(kana) && JAPANESE.test(kana)) {
    steps.unshift(`forms : (${kanaForms(kana).map(quote).join(' OR ')})`);
    if ([...kana].length >= 2) steps.push(`forms : (${kanaForms(kana).map((f) => `${quote(f)}*`).join(' OR ')})`);
  }
  return steps;
}

/** The FTS5 query that finds entries with any of these written forms or readings. */
export const formsMatch = (forms: string[]) => `forms : (${[...new Set(forms)].map(quote).join(' OR ')})`;

/**
 * Lower is better: an exact written form or reading; then a meaning that is
 * exactly the query, first as the entry's first meaning; then a form that
 * starts with it; then the rest. Common words first within each.
 */
export function searchRank(e: DictEntry, query: string): number {
  const q = query.normalize('NFKC').trim().toLowerCase();
  const kana = normalizeKana(q);
  const forms = [...e.kanji, ...e.kana].map((f) => f.text);
  // "to eat (e.g. a meal)" is exactly "eat".
  const bare = (g: string) => g.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').trim().replace(/^to /, '');
  const word = q.replace(/^to /, '');
  let score = 4;
  if (forms.includes(q) || forms.some((f) => normalizeKana(f) === kana && !LATIN.test(kana))) score = 0;
  else if (LATIN.test(q) && e.senses[0] && bare(e.senses[0].gloss[0] ?? '') === word) score = 1;
  else if (LATIN.test(q) && e.senses.slice(0, 2).some((s) => s.gloss.some((g) => bare(g) === word))) score = 2;
  else if (forms.some((f) => f.startsWith(q) || normalizeKana(f).startsWith(kana))) score = 3;
  // JMdict has no frequency ranks, only "common". Among common words, one
  // written with N5/N4 kanji or in hiragana is likelier to be the one a
  // learner at this level wants: 食べる before 喫する for "eat", 家 before
  // ハウス for "house".
  const [kanji, reading] = headPair(e);
  const beginner = kanji ? [...kanji].every((ch) => !HAN.test(ch) || JLPT_KANJI.has(ch)) : !KATAKANA_ONLY.test(reading);
  return score * 4 + (e.common ? 0 : 2) + (beginner ? 0 : 1);
}

const KATAKANA_ONLY = /^[\p{Script=Katakana}ー・]+$/u;
const JLPT_KANJI = new Set([...N5_KANJI, ...N4_KANJI]);

// ---------------------------------------------------------------- matching your words

export interface WordToMatch {
  kana: string;
  kanji: string | null;
  senses: string[];
}

/** A word's spelling as the dictionary writes it: no 〜 marks or spaces. */
export const lookupForm = (s: string) => s.normalize('NFKC').replace(/[〜～\s]/g, '');

/** The written form to look up, or null when there's none or it's kana (Renshuu puts みたい in both fields). */
export const writtenWithKanji = (kanji: string | null) => (kanji && HAN.test(kanji) ? lookupForm(kanji) : null);

/** The words two meaning lists share ("to eat, to live on" has eat, live). */
function meaningWords(senses: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of senses) for (const g of splitGlosses(stripTags(s))) for (const w of g.toLowerCase().split(/[^a-z]+/)) if (w.length > 2 && w !== 'the') out.add(w);
  return out;
}

export interface Match {
  entry: DictEntry;
  /** The written form and reading in the entry that match the word. */
  kanji: string | null;
  kana: string;
}

/**
 * The dictionary entry for one of your words: the same written form and
 * reading (katakana and hiragana alike). Several entries with that spelling
 * (コート: coat or court) are told apart by the meanings they share with
 * yours, then (for a word you write in kana) by an entry usually written in
 * kana, then by which is common. null when none fits.
 */
export function matchWord(word: WordToMatch, candidates: DictEntry[]): Match | null {
  const kanji = writtenWithKanji(word.kanji);
  const kana = normalizeKana(lookupForm(word.kana));
  const fits: Match[] = [];
  for (const entry of candidates) {
    for (const [k, r] of pairs(entry, true)) {
      if (normalizeKana(r) !== kana) continue;
      // Forms as NFKC, like yours: Ｔシャツ in JMdict is Tシャツ.
      if (kanji ? k !== null && k.normalize('NFKC') === kanji : true) {
        fits.push({ entry, kanji: k, kana: r });
        break;
      }
    }
  }
  if (!fits.length) return null;
  if (fits.length === 1) return fits[0];
  const mine = meaningWords(word.senses);
  const scored = fits.map((m) => {
    const theirs = meaningWords(senseStrings(m.entry.senses));
    let shared = 0;
    for (const w of mine) if (theirs.has(w)) shared++;
    // A kana-only word prefers an entry where kana is how it's written.
    const kanaFit = !kanji && (m.kanji === null || usuallyKana(m.entry, m.kanji, m.kana)) ? 1 : 0;
    return { m, shared, kanaFit };
  });
  scored.sort((a, b) => b.shared - a.shared || b.kanaFit - a.kanaFit || Number(b.m.entry.common) - Number(a.m.entry.common) || a.m.entry.seq - b.m.entry.seq);
  const best = scored[0].m;
  // Without kanji, show the reading on its own.
  return kanji ? best : { ...best, kanji: null };
}

/** What a word keeps from its entry: the link, readings per kanji and the usually-kana note. */
export interface WordDictInfo {
  dictSeq: number | null;
  furigana: Ruby[] | null;
  usuallyKana: boolean;
}

export function dictInfo(word: { kanji: string | null; kana: string }, match: Match | null): WordDictInfo {
  if (!match) return { dictSeq: null, furigana: null, usuallyKana: false };
  const kanji = writtenWithKanji(word.kanji);
  const ruby = kanji ? rubyFor(match.entry, match.kanji ?? kanji, match.kana) : null;
  // Only readings that spell out the word as you have it, written and read.
  const fits = ruby && ruby.map((r) => r[0]).join('') === word.kanji && normalizeKana(ruby.map((r) => r[1] ?? r[0]).join('')) === normalizeKana(word.kana);
  return {
    dictSeq: match.entry.seq,
    furigana: fits ? ruby : null,
    usuallyKana: usuallyKana(match.entry, kanji ?? match.kanji, match.kana),
  };
}

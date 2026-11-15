import type { DictEntry } from './dictEntry';
import { deinflect } from './deinflect';

// A long word split into the dictionary words it's made of, so a hard
// compound can be learned as parts: 行方不明 is 行方 "whereabouts" + 不明
// "unknown" (Mikita, 30 Oct: long compounds were the words that faded).
// Exact kanji meanings need kanji data (v0.3); these are whole words.

export interface WordPart {
  text: string;
  /** The dictionary form, when the part is a verb at the end in another form (入れず → 入れる, 利かず → 利く). */
  base?: string;
  /** Null for a piece that isn't a dictionary word itself (okurigana, a particle, a conjugated ending). */
  reading: string | null;
  gloss: string | null;
  /** The part's dictionary entry, for a piece that is a word. */
  seq?: number;
}

type KnownPart = { reading: string; gloss: string; seq: number };

const HAN = /\p{Script=Han}/u;
const KANA = /^[\p{Script=Hiragana}]+$/u;

/**
 * Dictionary forms a verb ending the word (from `from` on) may stand for:
 * 入れず is 入れる, 利かず is 利く (shared/deinflect.ts reads the endings).
 * A bare kanji plus る is never tried: 目覚まし is not 覚る, and 見ず
 * isn't split off as 見る.
 */
function verbForms(chars: string[], from: number): string[] {
  const tail = chars.slice(from).join('');
  return deinflect(tail)
    .filter((d) => (d.kind === 'v1' || d.kind === 'v5') && HAN.test(d.base))
    .filter((d) => d.kind !== 'v1' || KANA.test([...d.base].at(-2) ?? ''))
    .map((d) => d.base);
}

/** Longer words aren't split: they'd make the lookup big and they're rare. */
export const MAX_SPLIT = 12;

/** What to look up for `written`: every shorter run with a kanji in it, and the dictionary forms a verb ending it may have. */
export function partCandidates(written: string): string[] {
  const chars = [...written];
  if (chars.length < 2 || chars.length > MAX_SPLIT) return [];
  const out = new Set<string>();
  for (let i = 0; i < chars.length; i++) {
    for (let j = i + 1; j <= chars.length; j++) {
      if (j - i === chars.length) continue;
      const piece = chars.slice(i, j).join('');
      if (HAN.test(piece)) out.add(piece);
    }
    if (i > 0) for (const form of verbForms(chars, i)) out.add(form);
  }
  return [...out];
}

/**
 * What a dictionary entry gives each written form it has: the first (most
 * common) entry wins. Entries of the word itself are skipped: 夜明 is 夜明け
 * spelled short, not a part of it.
 */
export function partInfo(entries: DictEntry[], whole = ''): Map<string, KnownPart> {
  const out = new Map<string, KnownPart>();
  for (const e of entries) {
    if (e.kanji.some((k) => k.text === whole)) continue;
    const gloss = e.senses[0]?.gloss[0];
    if (!gloss) continue;
    for (const k of e.kanji) {
      if (out.has(k.text)) continue;
      // The reading that goes with this written form, when the entry says.
      const reading = e.kana.find((r) => !r.kanji || r.kanji.includes(k.text)) ?? e.kana[0];
      if (reading) out.set(k.text, { reading: reading.text, gloss, seq: e.seq });
    }
  }
  return out;
}

/**
 * Splits from the left, taking the longest dictionary word at each point
 * (and a verb at the end in its dictionary form: 入れず is 入れる).
 * Pieces that aren't words are joined into one part with no meaning. Returns
 * [] unless at least two parts are words: otherwise there's nothing to learn
 * from the split.
 */
export function splitParts(written: string, known: Map<string, KnownPart>): WordPart[] {
  const chars = [...written];
  const parts: WordPart[] = [];
  let i = 0;
  while (i < chars.length) {
    let found = 0;
    for (let j = chars.length; j > i; j--) {
      if (j - i === chars.length) continue;
      if (known.has(chars.slice(i, j).join(''))) {
        found = j;
        break;
      }
    }
    // A conjugated verb that ends the word beats a shorter word inside it.
    const verb = i > 0 && found < chars.length ? verbForms(chars, i).find((form) => known.has(form)) : undefined;
    if (verb) {
      parts.push({ text: chars.slice(i).join(''), base: verb, ...known.get(verb)! });
      break;
    }
    if (found) {
      const text = chars.slice(i, found).join('');
      parts.push({ text, ...known.get(text)! });
      i = found;
    } else {
      const last = parts[parts.length - 1];
      if (last && last.gloss === null) last.text += chars[i];
      else parts.push({ text: chars[i], reading: null, gloss: null });
      i++;
    }
  }
  return parts.filter((p) => p.gloss !== null).length >= 2 ? parts : [];
}

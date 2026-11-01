import type { DictEntry } from './dictEntry';

// A long word split into the dictionary words it's made of, so a hard
// compound can be learned as parts: 行方不明 is 行方 "whereabouts" + 不明
// "unknown" (Mikita, 30 Oct: long compounds were the words that faded).
// Exact kanji meanings need kanji data (v0.3); these are whole words.

export interface WordPart {
  text: string;
  /** The dictionary form, when the part is a conjugated verb at the end (入れず → 入れる). */
  base?: string;
  /** Null for a piece that isn't a dictionary word itself (okurigana, a particle, a conjugated ending). */
  reading: string | null;
  gloss: string | null;
}

const HAN = /\p{Script=Han}/u;
const KANA = /^[\p{Script=Hiragana}]+$/u;
/** A conjugated ending at the end of a word, up to this many kana, may stand for る (入れず is 入れる). */
const MAX_ENDING = 3;

/** Dictionary forms an ending-final piece may stand for: 入れず → 入れる. */
function verbForms(chars: string[], from: number): { at: number; form: string }[] {
  const out: { at: number; form: string }[] = [];
  for (let k = 1; k <= MAX_ENDING && chars.length - k > from; k++) {
    const stem = chars.slice(from, chars.length - k).join('');
    if (KANA.test(chars.slice(chars.length - k).join('')) && HAN.test(stem)) out.push({ at: chars.length - k, form: `${stem}る` });
  }
  return out;
}
/** Longer words aren't split: they'd make the lookup big and they're rare. */
export const MAX_SPLIT = 12;

/** The pieces of `written` worth looking up: every shorter run with a kanji in it. */
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
    for (const v of verbForms(chars, i)) if (i > 0) out.add(v.form);
  }
  return [...out];
}

/**
 * What a dictionary entry gives each written form it has: the first (most
 * common) entry wins. Entries of the word itself are skipped: 夜明 is 夜明け
 * spelled short, not a part of it.
 */
export function partInfo(entries: DictEntry[], whole = ''): Map<string, { reading: string; gloss: string }> {
  const out = new Map<string, { reading: string; gloss: string }>();
  for (const e of entries) {
    if (e.kanji.some((k) => k.text === whole)) continue;
    const gloss = e.senses[0]?.gloss[0];
    if (!gloss) continue;
    for (const k of e.kanji) {
      if (out.has(k.text)) continue;
      // The reading that goes with this written form, when the entry says.
      const reading = e.kana.find((r) => !r.kanji || r.kanji.includes(k.text)) ?? e.kana[0];
      if (reading) out.set(k.text, { reading: reading.text, gloss });
    }
  }
  return out;
}

/**
 * Splits from the left, taking the longest dictionary word at each point
 * (and a verb at the end in its dictionary form, so 入れず is 入れる).
 * Pieces that aren't words are joined into one part with no meaning. Returns
 * [] unless at least two parts are words: otherwise there's nothing to learn
 * from the split.
 */
export function splitParts(written: string, known: Map<string, { reading: string; gloss: string }>): WordPart[] {
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
    const verb = i > 0 && found < chars.length ? verbForms(chars, i).find((v) => known.has(v.form)) : undefined;
    if (verb) {
      parts.push({ text: chars.slice(i).join(''), base: verb.form, ...known.get(verb.form)! });
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

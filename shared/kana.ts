import { toHiragana } from 'wanakana';

// Checking a typed answer for a meaning→Japanese card.
// Accepts romaji (converted), hiragana or katakana for the reading, and the
// exact written form if the learner typed it with a Japanese keyboard.

export function normalizeKana(input: string): string {
  const s = input.normalize('NFKC').trim().replace(/\s+/g, '');
  return toHiragana(s, { passRomaji: false });
}

export interface AnswerCheck {
  correct: boolean;
  normalized: string;
}

export function checkReading(input: string, expected: { kana: string; kanji: string | null }): AnswerCheck {
  const raw = input.normalize('NFKC').trim();
  const normalized = normalizeKana(raw);
  if (!raw) return { correct: false, normalized };
  if (expected.kanji && raw === expected.kanji) return { correct: true, normalized: raw };
  return { correct: normalized === normalizeKana(expected.kana), normalized };
}

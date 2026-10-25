import { toHiragana } from 'wanakana';

// Furigana only where it helps: over runs of kanji that hold a kanji you
// don't know yet. "Known" starts from the JLPT lists and can be adjusted.

// Common JLPT N5 and N4 kanji lists (the JLPT publishes no official list).
export const N5_KANJI =
  '日一国人年大十二本中長出三時行見月後前生五間上東四今金九入学高円子外八六下来気小七山話女北午百書先名川千水半男西電校語土木聞食車何南万毎白天母火右読友左休父雨';
export const N4_KANJI =
  '会同事自社発者地業方新場員立開手力問代明動京目通言理体田主題意不作用度強公持野以思家世多正安院心界教文元重近考画海売知道集別物使品計死特私始朝運終台広住真有口少町料工建空急止送切転研足究楽起着店病質待試族銀早映親験英医仕去味写字答夜音注帰古歌買悪図週室歩風紙黒花春赤青館屋色走秋夏習駅洋旅服夕借曜飲肉貸堂鳥飯勉冬昼茶弟牛魚兄犬妹姉漢';

export type KanjiLevel = 'none' | 'n5' | 'n4';

export interface FuriganaPrefs {
  /** Kanji up to this level count as known. */
  kanjiLevel: KanjiLevel;
  /** Extra kanji you know beyond the level. */
  knownKanji: string;
  /** Kanji that always get furigana, even within the level. */
  learningKanji: string;
}

export interface Segment {
  text: string;
  /** Set on a run of kanji whose reading should be shown above it. */
  ruby?: string;
}

const KANJI = /[\p{Script=Han}々〆ヶ]/u;
const isKanji = (ch: string) => KANJI.test(ch);

export function knownKanjiSet(prefs: FuriganaPrefs): Set<string> {
  const base = prefs.kanjiLevel === 'n4' ? N5_KANJI + N4_KANJI : prefs.kanjiLevel === 'n5' ? N5_KANJI : '';
  const known = new Set([...base, ...prefs.knownKanji].filter(isKanji));
  for (const ch of prefs.learningKanji) known.delete(ch);
  return known;
}

/** Splits the written form into kanji and kana runs. */
function runs(written: string): { text: string; kanji: boolean }[] {
  const out: { text: string; kanji: boolean }[] = [];
  for (const ch of written) {
    const kanji = isKanji(ch);
    const last = out[out.length - 1];
    if (last && last.kanji === kanji) last.text += ch;
    else out.push({ text: ch, kanji });
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Lines the reading up with the written form: 食べ物/たべもの → 食(た) べ 物(もの).
 * Falls back to one reading over the whole word when the kana don't line up.
 */
export function alignReading(written: string, reading: string): { text: string; reading?: string }[] {
  const parts = runs(written);
  if (!parts.some((p) => p.kanji)) return [{ text: written }];
  const pattern = parts.map((p) => (p.kanji ? '(.+?)' : escape(toHiragana(p.text)))).join('');
  const match = new RegExp(`^${pattern}$`).exec(toHiragana(reading));
  if (!match) return [{ text: written, reading }];
  let group = 1;
  return parts.map((p) => (p.kanji ? { text: p.text, reading: match[group++] } : { text: p.text }));
}

/** The written form split into segments, with furigana over runs that hold an unknown kanji. */
export function furigana(written: string, reading: string, known: Set<string>): Segment[] {
  return alignReading(written, reading).map(({ text, reading }) =>
    reading !== undefined && [...text].some((ch) => isKanji(ch) && !known.has(ch)) ? { text, ruby: reading } : { text },
  );
}
